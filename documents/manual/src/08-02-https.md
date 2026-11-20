# HTTPS

emcc serves HTTPS itself, with no other program in front of it. You give it a certificate, and it listens on one port, for the pages and for the live map. This chapter says which certificates it takes, where the files go, how to make a certificate for a test, and what to set at your identity system.

**Draft.** Written from ADR-0061. Checked against a release built from commit c60fea19 and run without administrator rights. Text with CHECK in square brackets waits for a later check.

## Why

With login, the session cookie is marked **Secure** only when the page came over HTTPS, and the identity system's redirect address must be an `https://` address. Outside the server's own computer, use HTTPS. Without a certificate the server serves plain HTTP, as before.

## The certificate

emcc takes a certificate and its private key in one of three forms:

| Form | Files | Use it when |
|---|---|---|
| **PKCS#12** | One file, `.p12` or `.pfx`, with the certificate, its chain and the key | This is the one to choose. Windows' certificate export and most certificate authorities give it |
| **PEM** | A file with the certificate and its chain, and a file with the private key | Your certificate authority gives PEM files. The key may be unencrypted, with the file's permissions as its protection, or encrypted with a password |
| **JKS** | One Java key store | You already have a Java key store |

The certificate must name the host name that users type, as a subject alternative name. A certificate for `emcc.example.org` does not serve `https://10.1.2.3/`.

emcc does not make certificates. The certificate is your organisation's to issue.

## Setting it up

1. Put the key store, or the certificate and key files, in `settings/credentials/`.
2. Write `settings/credentials/https.properties`. The release has a template, `https-example.properties`, with a comment on every key: copy it to `https.properties` and set the lines. emcc uses the settings of Spring Boot's SSL bundle, with the bundle named `emcc`. For a PKCS#12 file:

   ```
   spring.ssl.bundle.jks.emcc.keystore.location=%emcc%/settings/credentials/emcc.p12
   spring.ssl.bundle.jks.emcc.keystore.type=PKCS12
   spring.ssl.bundle.jks.emcc.keystore.password=<the password>
   ```

   Where the store holds more than one key, add `spring.ssl.bundle.jks.emcc.key.alias=<the key's alias>`. For a JKS store, set the type to `JKS`. For PEM files:

   ```
   spring.ssl.bundle.pem.emcc.keystore.certificate=%emcc%/settings/credentials/emcc.crt
   spring.ssl.bundle.pem.emcc.keystore.private-key=%emcc%/settings/credentials/emcc.key
   spring.ssl.bundle.pem.emcc.keystore.private-key-password=<the key's password, if it has one>
   ```

3. Add the host name that users type to `emc2.allowed-hosts` in `emcc.properties`, if it is not there.
4. Restart the server. When it is ready, it prints a line that begins with `emcc ready at https://`, in the window and in `logs/emcc.log`. Open that address.

You do not set `server.ssl.bundle`: the server sets it by itself when `https.properties` names a certificate. Leave it alone. The certificate files are best kept in `settings/credentials/` too, so that they have the same protection.

The password is never written in `emcc.properties`, on the command line or in the definition of the service. An environment variable may hold it instead. See [The settings files](08-01-settings-files.md).

## One port

With HTTPS on, **plain HTTP is off**. Pages and the live map use the one port. The live map's WebSocket runs on the same port. The server accepts TLS 1.2 and TLS 1.3 only, with the Java runtime's default cipher suites.

If you want a second port that only sends browsers on to the HTTPS port, for example 80, set `emc2.https.redirect-port` in `emcc.properties`. It is off by default. A request to that port gets the answer 307 and the address on the HTTPS port, and nothing else is served there. The ready line then says so: `emcc ready at https://localhost:18120/ (http://localhost:18121/ redirects to it)`. The setting needs HTTPS: **with a redirect port and no certificate the server does not start**, and says that the redirect port is set but HTTPS is off.

## HSTS

Over HTTPS the server tells the browser to use HTTPS for this host name for a while (HSTS). The time is the setting `emc2.https.hsts-max-age`, in seconds. The default is 31 536 000, one year, and 0 sends no HSTS at all.

**Be careful with a certificate that the browser does not trust, such as a self-signed one.** A browser that has been told to use only HTTPS for a host name, and does not trust its certificate, can refuse to open the host name at all until that time has passed. Keep the time short while you test.

## A renewed certificate

Replace the files in `settings/credentials/` with the new ones, with the same names. emcc **takes the new certificate without a restart**: it watches the files, and the next connection that a browser makes gets the new one, after some seconds. Keep the store's password, or restart the server after you changed it in `https.properties`.

## The certificate in the Monitor

The [Monitor workspace](06-00-monitor.md) has a tile **HTTPS** among the Core tiles. It shows the date the certificate is valid until, a chip (*valid*, *expires soon* from **30 days** before the date, or *expired*), and under it the certificate's subject and its issuer. Over plain HTTP the tile says *Off*. Look at it from time to time.

## A certificate for a test

For a test you can make a self-signed certificate with `keytool`, the Java tool for keys. The release's Java runtime has it, as `runtime\bin\keytool.exe`. Run it in a command window in the `settings/credentials` folder, with the path to it. Use your own host name instead of `emcc.example.org`.

```
..\..\runtime\bin\keytool -genkeypair -alias emcc -keyalg RSA -keysize 3072 -validity 90 -storetype PKCS12 -keystore emcc.p12 -dname "CN=emcc.example.org" -ext "SAN=dns:emcc.example.org,dns:localhost,ip:127.0.0.1"
```

`keytool` asks for a password for the store. Put it in `https.properties`.

The browser then warns that the certificate is not trusted. A certificate that you do not trust is no protection against someone who sits between the browser and the server. For anything but a test, use a certificate from your own certificate authority.

## Login over HTTPS

When HTTPS is on, change the addresses at the identity system to `https://`. For Keycloak, in the client `emc2`:

| Setting at the client | Value |
|---|---|
| Valid redirect URIs | `https://<name>:<port>/login/oauth2/code/emc2` |
| Valid post logout redirect URIs | `https://<name>:<port>/` |
| Backchannel logout URL | `https://<name>:<port>/logout/connect/back-channel/emc2` |

See [What you may bring yourself](08-03-infrastructure.md). The no-login mode may use HTTPS too. On the server's own computer, plain HTTP stays the default.

## A proxy that ends TLS

A reverse proxy in front of emcc, which ends TLS and sends plain HTTP to emcc, is still supported, with the settings it has always had. emcc then trusts the proxy's headers for the address that the user typed. Three settings in `emcc.properties` do it:

```
server.forward-headers-strategy=native
server.tomcat.remoteip.internal-proxies=10\\.0\\.0\\.5
emc2.allowed-hosts=emcc.example.org
```

`native` takes the host name, the address and `https` from the `X-Forwarded-` headers of the proxy; the default `none` ignores them, and no other value is accepted. `internal-proxies` is the address of the proxy as a regular expression, and the proxies that match it are the only ones that emcc believes. **It must be set**: with `native` and no value the server does not start, and the log says that Tomcat's default would trust every address of the private ranges. In a `.properties` file a backslash is written twice, as above. `emc2.allowed-hosts` must hold the name that users type.

## When something is wrong

| What you see | What to do |
|---|---|
| The server does not start, and the log says *keystore password was incorrect* and names the store | The password in `https.properties` is not the store's |
| The server does not start, and the log says *HTTPS cannot start: spring.ssl.bundle.jks.emcc.keystore.location (in settings/credentials/https.properties) names `C:\...\emcc-server.p12`, which is not a file* | The setting names a file that is not there. The message gives the setting, the settings file and the full path: put the key store there, or correct the setting. A path with `%emcc%/` is shown with the emcc folder written out |
| The server does not start, and the log names the certificate in another way | Its type is wrong, or the file is not a key store. Check `https.properties` |
| The server does not start and says that the redirect port is set, but HTTPS is off | Name the certificate, or leave `emc2.https.redirect-port` empty |
| The server does not start and says that `server.tomcat.remoteip.internal-proxies` is not set | You chose `native` for the forward headers. Name the proxy there |
| The browser says the certificate is for another name | The certificate does not name the host name you typed. Make one that does |
| The browser says the connection is not private | The certificate is not trusted by this computer, or has expired. For a test certificate, this is what to expect |
| The browser refuses a host name that it used to open | The server sent HSTS with a certificate that the browser now does not trust. Wait for the time to pass, or clear the browser's HSTS entry for the host |
| "Invalid parameter: redirect_uri" at the login | The identity system still has `http://` addresses. Change them as above |
| The browser cannot connect to the old `http://` address | Plain HTTP is off when HTTPS is on. Open the `https://` address |
