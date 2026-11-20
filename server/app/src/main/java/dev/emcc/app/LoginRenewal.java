package dev.emcc.app;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import java.time.Duration;
import java.time.Instant;
import java.util.Set;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.client.OAuth2AuthorizeRequest;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClient;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientManager;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizedClientRepository;
import org.springframework.security.oauth2.core.OAuth2AuthorizationException;
import org.springframework.stereotype.Component;
import org.springframework.web.util.WebUtils;

/**
 * Keeps a login only as long as the IAM agrees (ADR-0022): renews the access token with the
 * refresh token, and ends the login session when the IAM refuses.
 *
 * <ul>
 *   <li>{@link #renew}: the shell's keep-alive ({@link SessionController}) renews shortly before
 *       the token expires (Spring's minute of clock skew).
 *   <li>{@link #checkExpired}: every request with login ({@link AccessTokenFilter}); only when the
 *       token has expired already does it ask the IAM. So no request is served on a token that has
 *       expired and cannot be renewed, whoever sends it, and a revocation at the IAM counts within
 *       one token lifetime (security review R2).
 *   <li>Refused ({@code invalid_grant}, {@code invalid_token}, {@code unauthorized_client}): the
 *       login session ends; the user's live picture closes with {@code 4401} ({@link
 *       LoginSessions}). The IAM cannot be reached or fails: {@link Outcome#OUTAGE}, nothing ends,
 *       so an IAM outage logs nobody out.
 *   <li>Renewals of one HTTP session take turns (several tabs share it): with refresh tokens the IAM
 *       rotates, two at once would use the same refresh token, and the second would be refused. The
 *       lock is the session's own mutex, held for the renewal only (a call to the IAM, with its
 *       timeouts).
 *   <li>After an outage, the session's requests answer {@link Outcome#OUTAGE} for {@link
 *       #outagePause} without asking the IAM again: requests that waited for the lock, or come in
 *       the next seconds, do not each wait for the IAM's timeouts once more.
 * </ul>
 */
@Component
class LoginRenewal {

  enum Outcome { VALID, ENDED, OUTAGE }

  /** @param expiresAt the access token's expiry when {@link Outcome#VALID} */
  record Result(Outcome outcome, @Nullable Instant expiresAt) {}

  /** The IAM's answers that mean the login cannot go on (RFC 6749, 5.2); anything else is an outage. */
  static final Set<String> REFUSED = Set.of("invalid_grant", "invalid_token", "unauthorized_client");

  /** Session attribute: until when the IAM is not asked again after an outage. */
  static final String OUTAGE_UNTIL = LoginRenewal.class.getName() + ".OUTAGE_UNTIL";

  private static final Logger LOG = LoggerFactory.getLogger(LoginRenewal.class);

  /** How long a session does not ask the IAM again after an outage; the tests shorten it. */
  volatile Duration outagePause = Duration.ofSeconds(5);

  private final ObjectProvider<OAuth2AuthorizedClientManager> clients;
  private final ObjectProvider<OAuth2AuthorizedClientRepository> authorizedClients;
  private final LoginSessions loginSessions;

  LoginRenewal(ObjectProvider<OAuth2AuthorizedClientManager> clients, ObjectProvider<OAuth2AuthorizedClientRepository> authorizedClients,
      LoginSessions loginSessions) {
    this.clients = clients;
    this.authorizedClients = authorizedClients;
    this.loginSessions = loginSessions;
  }

  /** Every request: asks the IAM only when the access token has expired. */
  Result checkExpired(HttpServletRequest request, HttpServletResponse response, OAuth2AuthenticationToken login) {
    OAuth2AuthorizedClient client =
        authorizedClients.getObject().loadAuthorizedClient(login.getAuthorizedClientRegistrationId(), login, request);
    if (client == null) {
      return end(request, "the login has no tokens");
    }
    Instant expiresAt = client.getAccessToken().getExpiresAt();
    if (expiresAt != null && expiresAt.isAfter(Instant.now())) {
      return new Result(Outcome.VALID, expiresAt);
    }
    return renew(request, response, login);
  }

  /** Renews the access token if it expires within a minute; ends the login when the IAM refuses. */
  Result renew(HttpServletRequest request, HttpServletResponse response, OAuth2AuthenticationToken login) {
    HttpSession session = request.getSession(false);
    if (session == null) {
      return end(request, "the login session has ended already");
    }
    OAuth2AuthorizedClient client;
    synchronized (WebUtils.getSessionMutex(session)) {
      if (session.getAttribute(OUTAGE_UNTIL) instanceof Instant until && Instant.now().isBefore(until)) {
        return new Result(Outcome.OUTAGE, null);
      }
      try {
        client = clients.getObject().authorize(OAuth2AuthorizeRequest.withClientRegistrationId(login.getAuthorizedClientRegistrationId())
            .principal(login)
            .attribute(HttpServletRequest.class.getName(), request)
            .attribute(HttpServletResponse.class.getName(), response)
            .build());
      } catch (OAuth2AuthorizationException e) {
        if (REFUSED.contains(e.getError().getErrorCode())) {
          return end(request, "the IAM refused to renew the login (" + e.getError().getErrorCode() + ")");
        }
        LOG.warn("Could not renew a login, the IAM did not answer properly; trying again later: {}", e.getMessage());
        return outage(session);
      } catch (RuntimeException e) {
        if (request.getSession(false) == null) { // invalidated meanwhile, e.g. by a logout in another tab
          return end(request, "the login session ended while it was renewed");
        }
        LOG.warn("Could not renew a login, the IAM cannot be reached; trying again later: {}", e.toString());
        return outage(session);
      }
    }
    Instant expiresAt = client == null ? null : client.getAccessToken().getExpiresAt();
    if (expiresAt == null || !expiresAt.isAfter(Instant.now())) {
      return end(request, "the login expired and cannot be renewed");
    }
    return new Result(Outcome.VALID, expiresAt);
  }

  private Result outage(HttpSession session) {
    try {
      session.setAttribute(OUTAGE_UNTIL, Instant.now().plus(outagePause));
    } catch (IllegalStateException ended) {
      // invalidated meanwhile: nothing to remember
    }
    return new Result(Outcome.OUTAGE, null);
  }

  /**
   * Ends the login session: its live picture first (with 4401, before Tomcat's 1008), then the
   * session. The request goes on without login.
   */
  private Result end(HttpServletRequest request, String why) {
    LOG.info("Ending a login session: {}", why);
    HttpSession session = request.getSession(false);
    if (session != null) {
      try {
        loginSessions.end(session.getId());
        session.invalidate();
      } catch (IllegalStateException ended) {
        // invalidated meanwhile by another request: ended already
      }
    }
    SecurityContextHolder.clearContext();
    return new Result(Outcome.ENDED, null);
  }
}
