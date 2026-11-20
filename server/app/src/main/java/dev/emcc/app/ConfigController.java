package dev.emcc.app;

import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import org.jspecify.annotations.Nullable;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

/**
 * What the web client needs to know about this server before it loads the plugins (T-014): the
 * default security label, which every plugin's web part gets as {@code ctx.defaultLabel}, and the
 * login mode with the user (ADR-0022), so that the shell shows who is logged in, or that nobody is;
 * the user's permissions and the data types with their effective behaviour, which web parts get
 * as {@code ctx.user} and {@code ctx.dataTypes} (SDK v1), and the declared fields ({@code
 * ctx.declaredFields}, SDK 1.2.0); and for the shell alone the order of
 * classifications per security policy (Settings › Layers, ADR-0031 point 3), the installation's
 * default look (ADR-0034) and how a premade label is written (Settings › Labeling, T-170).
 */
@RestController
class ConfigController {

  /**
   * The answer of {@code GET /api/config}.
   *
   * @param defaultLabel in its model form ({@code model/schemas})
   * @param loginMode {@code oidc} or {@code none}
   * @param user the request's user; null when nobody is logged in
   * @param dataTypes the available data types, {@code core.general} first ({@code PluginHost.dataTypesJson})
   * @param classificationOrders each configured policy's classifications, lowest first ({@link ClassificationProperties})
   * @param defaultLook the installation's default look (ADR-0034), for every user who has not chosen one
   * @param declaredFields the fields the loaded plugins declare (SDK 1.2.0, ADR-0038; {@code PluginHost.declaredFieldsJson}),
   *     fixed while the server runs
   * @param workspaces the workspaces this user may see, View first (SDK 1.2.0, ADR-0039; {@code ctx.workspaces};
   *     {@code PluginHost.workspacesJson})
   * @param fieldSets the field sets the loaded plugins declare (SDK 1.4.0, ADR-0050; {@code ctx.fieldSets};
   *     {@code PluginHost.fieldSetsJson}), fixed while the server runs
   * @param relationKinds the relation kinds the loaded plugins declare, the line's defaults filled in (SDK 1.4.0,
   *     ADR-0051; {@code ctx.relationKinds}; {@code PluginHost.relationKindsJson}), fixed while the server runs
   * @param labelFormat how the shell writes a premade label as text (Settings › Labeling, T-170; {@link LabelingProperties})
   * @param labelDefinitions the classification sets and policies of Settings › Labeling (round 3b; {@link LabelingDefinitions})
   */
  record ClientConfig(
      JsonNode defaultLabel, String loginMode, @Nullable UserInfo user, JsonNode dataTypes, Map<String, List<String>> classificationOrders,
      String defaultLook, JsonNode declaredFields, JsonNode workspaces, JsonNode fieldSets, JsonNode relationKinds,
      LabelingProperties.Format labelFormat, JsonNode labelDefinitions) {}

  /**
   * What the browser learns about its user ({@code ctx.user}).
   *
   * @param noLogin true in the no-login mode: the local user, who has every permission
   */
  record UserInfo(String id, String name, List<String> permissions, boolean noLogin) {}

  private final ECoreLifecycle ecore;
  private final CurrentUser currentUser;
  private final Map<String, List<String>> classificationOrders;
  private final LabelingProperties.Format labelFormat;
  private final JsonNode labelDefinitions;

  ConfigController(ECoreLifecycle ecore, CurrentUser currentUser, LabelingProperties labeling, LabelingDefinitions definitions) {
    this.ecore = ecore;
    this.currentUser = currentUser;
    this.labelFormat = labeling.format();
    this.labelDefinitions = definitions.json();
    this.classificationOrders = ecore.core().config().classificationOrders(); // checked by ECoreLifecycle
  }

  @GetMapping("/api/config")
  ClientConfig config(HttpServletRequest request) {
    User user = currentUser.of(request);
    dev.emcc.sdk.User sdk = user == null ? null : PluginController.sdkUser(user, currentUser.mode());
    UserInfo info = sdk == null ? null
        : new UserInfo(sdk.id(), sdk.name(), new TreeSet<>(sdk.permissions()).stream().toList(), sdk.noLogin());
    return new ClientConfig(ecore.core().json().toTree(ecore.core().config().defaultLabel()), currentUser.mode().value(), info,
        ecore.core().plugins().dataTypesJson(), classificationOrders, ecore.core().look().current(),
        ecore.core().plugins().declaredFieldsJson(), ecore.core().plugins().workspacesJson(p -> sdk != null && sdk.has(p)),
        ecore.core().plugins().fieldSetsJson(), ecore.core().plugins().relationKindsJson(), labelFormat, labelDefinitions);
  }
}
