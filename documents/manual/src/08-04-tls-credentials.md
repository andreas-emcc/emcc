# TLS credentials

A TLS credential is the key material that emcc uses when a link connects to another system over TLS: the certificates it trusts, and the certificate that proves who it is. The main user is a Cursor on Target link to a TAK Server over TLS. This chapter says how to set one up, how a link picks it, and how you see when it expires.

**Draft.** Written from ADR-0062. Checked against a release built from commit c60fea19 and run without administrator rights. Text with CHECK in square brackets waits for a later check.

## How emcc handles them

- The key material belongs to the server. A plugin gets a connection that uses it, and **never sees the keys or the passwords**. The browser never sees them either.
- A credential has a **name** and a **file** of its own in `settings/credentials/`, so that it can have its own permissions.
- A link picks a credential by its name in Settings. The settings never hold a path or a password.
- emcc uses TLS 1.2 and TLS 1.3, and checks that the certificate of the other system names the host that the link connects to.

## What a TAK Server gives you

Your TAK administrator gives you two things:

- **The certificate authority that signed the TAK Server's certificate**, as a trust store (`.p12` or `.jks`) or as a PEM file. emcc needs it to know that it talks to your TAK Server.
- **A client certificate for emcc**, with its private key, as a `.p12` file or as PEM files, issued for a user name that the TAK Server knows. Where the TAK Server asks for a client certificate, which it does on its TLS port, emcc needs it.

The trust store is always needed. The key store is needed where the other system asks for a client certificate.

## Setting one up

1. Choose a name, in lower case with hyphens, for example `tak-north`.
2. Put the files in `settings/credentials/`.
3. Write `settings/credentials/tls-tak-north.properties`. The release has a template, `tls-example.properties`, with a comment on every key: copy it and set the lines with your name. For `.p12` files:

   ```
   emc2.tls.tak-north.trust-store=%emcc%/settings/credentials/tak-truststore.p12
   emc2.tls.tak-north.trust-store-type=PKCS12
   emc2.tls.tak-north.trust-store-password=<the password>
   emc2.tls.tak-north.key-store=%emcc%/settings/credentials/tak-client.p12
   emc2.tls.tak-north.key-store-type=PKCS12
   emc2.tls.tak-north.key-store-password=<the password>
   ```

   The types are `PKCS12`, `JKS` and `PEM`. A line for the type may be left out: the file's ending then decides, `.jks` is JKS, `.pem`, `.crt` and `.cer` are PEM, and any other ending is PKCS12. For PEM, the trust is a file with the certificate authority's certificate, and it has no password. The identity is a file with the certificate chain, this end's certificate first, and a file with the private key:

   ```
   emc2.tls.tak-north.trust-store=%emcc%/settings/credentials/tak-ca.pem
   emc2.tls.tak-north.trust-store-type=PEM
   emc2.tls.tak-north.key-store-type=PEM
   emc2.tls.tak-north.certificate=%emcc%/settings/credentials/tak-client.pem
   emc2.tls.tak-north.private-key=%emcc%/settings/credentials/tak-client.key
   emc2.tls.tak-north.private-key-password=<the key's password, only if it is encrypted>
   ```

   The private key is in PKCS #8 form, plain or encrypted, or an unencrypted RSA or EC key, as TAK Server's tools give them.
4. Restart the server. A credential is read when the server starts, so a changed one also needs a restart. The log then has a line `TLS credential tak-north read from emc2.tls.tak-north.*`.
5. Add or open the link in [Settings, Cursor on Target](05-10-cot.md), set its Transport to `tls`, and choose your credential in the field **TLS credential**, in the group **Connection**. The field is greyed for the other transports.

Paths may start with `%emcc%/`. The files and the passwords are as protected as the rest of the folder: see [The settings files](08-01-settings-files.md).

## Which credential a link uses

The link's **TLS credential** field lists the names of the credentials that emcc has. It lists names only, never paths or passwords. **When the field is empty, emcc uses the link's own name**, as earlier releases did, so an installation keeps working. A link named `tak-north` with no credential chosen uses the credential `tak-north`.

That is why you should **choose the credential explicitly** on a link. If you rename a link that has none chosen, it loses its certificate.

## The old keys

Earlier releases named credentials with `emc2.listeners.credentials.<name>.*` in `application-local.properties`. Those keys are still read, and the server logs a warning that they are deprecated. Where both name the same credential, the new file wins.

## Expiry

The [Monitor workspace](06-00-monitor.md) has a section **TLS credentials**, below the Core tiles. It has a row for each certificate: the credential's name, whether the certificate is the **Client** certificate (the identity) or a **Trusted** one (in the trust store), its subject, its issuer and the date it **expires**. A certificate that expires within **30 days** is marked, and an expired one is marked in red with the word *expired* and the date. A credential that cannot be read gets one row, *Cannot be used*, and the reason. The section says that a credential is read when the server starts, and that a changed one needs a restart.

A link whose credential has expired, is missing or cannot be read fails at its start, before it connects to anything, and its status says so, for example `the TLS credential 'tak-north' is missing`. For an expired or an unreadable one the message is ECore's: it names the credential and the date, and never a path. The link then tries again with the waits that links always have.

## What is not covered

TLS for connections that **listen** comes later. In this release a plugin's TLS is for connections that emcc opens to other systems.

## When something is wrong

| What you see | What to do |
|---|---|
| The link does not connect, and the log says the handshake failed | The trust store does not hold the certificate authority of the other system, or the other system does not accept emcc's client certificate. Check the credential, and the user the certificate was issued for |
| The log says the certificate is for another host | The link's Host is not a name in the other system's certificate. Use the name the certificate has |
| The link's status says the certificate has expired | Get a new certificate, replace the file and restart the server |
| The link has no credential, and the log names a missing credential | The link uses its own name as the credential's name, and no such credential exists. Choose one in the link's form |
| The Monitor marks a certificate | It expires within 30 days. Get a new one in time |
| The server logs a warning about the file's permissions | See [The settings files](08-01-settings-files.md) |
