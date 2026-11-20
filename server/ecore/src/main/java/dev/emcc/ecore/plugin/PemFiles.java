package dev.emcc.ecore.plugin;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.security.spec.InvalidKeySpecException;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.crypto.Cipher;
import javax.crypto.EncryptedPrivateKeyInfo;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import org.jspecify.annotations.Nullable;

/**
 * PEM files of a TLS credential (ADR-0062 point 2, M9 C3): certificates, and a private key as PKCS #8 (plain, or
 * encrypted with a password as OpenSSL 3 and TAK Server's tools write it), or unencrypted as {@code RSA PRIVATE KEY}
 * (PKCS #1) or {@code EC PRIVATE KEY} (SEC 1). OpenSSL's older encrypted form ({@code Proc-Type: 4,ENCRYPTED}) is not
 * read; the message says how to convert it. Errors never show a key or a password.
 */
final class PemFiles {

  private static final Pattern BLOCK = Pattern.compile(
      "-----BEGIN ([A-Z0-9 ]+)-----\\r?\\n(.*?)-----END \\1-----", Pattern.DOTALL);
  private static final List<String> KEY_ALGORITHMS = List.of("RSA", "EC", "Ed25519", "Ed448", "RSASSA-PSS");
  /** rsaEncryption, with its NULL parameters. */
  private static final byte[] RSA_ALGORITHM = hex("300d06092a864886f70d0101010500");
  /** id-ecPublicKey. */
  private static final byte[] EC_OID = hex("06072a8648ce3d0201");

  private PemFiles() {}

  /** One block: its label, whether it has headers (OpenSSL's old encryption), and its bytes. */
  record Block(String label, boolean headers, byte[] der) {}

  static List<Block> read(Path file) throws IOException {
    String text = Files.readString(file, StandardCharsets.ISO_8859_1); // any byte reads; PEM itself is ASCII
    List<Block> blocks = new ArrayList<>();
    Matcher m = BLOCK.matcher(text);
    while (m.find()) {
      String body = m.group(2);
      boolean headers = body.lines().anyMatch(l -> l.contains(":"));
      String base64 = body.lines().filter(l -> !l.contains(":")).map(String::strip).reduce("", String::concat);
      try {
        blocks.add(new Block(m.group(1), headers, Base64.getDecoder().decode(base64)));
      } catch (IllegalArgumentException e) {
        throw new IOException("its " + m.group(1) + " block is not Base64");
      }
    }
    return blocks;
  }

  /** Every {@code CERTIFICATE} in the file, in order. */
  static List<X509Certificate> certificates(Path file) throws IOException, GeneralSecurityException {
    CertificateFactory factory = CertificateFactory.getInstance("X.509");
    List<X509Certificate> out = new ArrayList<>();
    for (Block b : read(file)) {
      if (b.label().equals("CERTIFICATE") || b.label().equals("TRUSTED CERTIFICATE")) {
        out.add((X509Certificate) factory.generateCertificate(new ByteArrayInputStream(b.der())));
      }
    }
    if (out.isEmpty()) {
      throw new IOException("it has no PEM certificate (-----BEGIN CERTIFICATE-----)");
    }
    return out;
  }

  /** The file's private key. */
  static PrivateKey privateKey(Path file, @Nullable String password) throws IOException, GeneralSecurityException {
    for (Block b : read(file)) {
      switch (b.label()) {
        case "PRIVATE KEY" -> {
          return key(b.der());
        }
        case "ENCRYPTED PRIVATE KEY" -> {
          if (password == null) {
            throw new IOException("its key is encrypted and the key's password is missing");
          }
          byte[] plain = decrypt(b.der(), password);
          try {
            return key(plain);
          } catch (InvalidKeySpecException e) { // a wrong password may still give valid padding, and then garbage
            throw new IOException("its key cannot be decrypted: the key's password is wrong, or the key is damaged");
          }
        }
        case "RSA PRIVATE KEY", "EC PRIVATE KEY" -> {
          if (b.headers()) {
            throw new IOException("its " + b.label() + " is encrypted in OpenSSL's old form, which emcc does not read; convert it "
                + "with: openssl pkcs8 -topk8 -in <key file> -out <new key file>");
          }
          return key(b.label().startsWith("RSA") ? rsaToPkcs8(b.der()) : ecToPkcs8(b.der()));
        }
        default -> { /* e.g. EC PARAMETERS or a certificate next to the key */ }
      }
    }
    throw new IOException("it has no PEM private key (-----BEGIN PRIVATE KEY-----)");
  }

  private static byte[] decrypt(byte[] der, String password) throws IOException, GeneralSecurityException {
    EncryptedPrivateKeyInfo info = new EncryptedPrivateKeyInfo(der);
    PBEKeySpec spec = new PBEKeySpec(password.toCharArray());
    try {
      Cipher cipher = Cipher.getInstance(info.getAlgName());
      cipher.init(Cipher.DECRYPT_MODE, SecretKeyFactory.getInstance(info.getAlgName()).generateSecret(spec), info.getAlgParameters());
      return info.getKeySpec(cipher).getEncoded();
    } catch (InvalidKeySpecException e) {
      throw new IOException("its key cannot be decrypted: the key's password is wrong");
    } finally {
      spec.clearPassword();
    }
  }

  private static PrivateKey key(byte[] pkcs8) throws GeneralSecurityException {
    for (String algorithm : KEY_ALGORITHMS) {
      try {
        return KeyFactory.getInstance(algorithm).generatePrivate(new PKCS8EncodedKeySpec(pkcs8));
      } catch (InvalidKeySpecException | java.security.NoSuchAlgorithmException e) {
        // the next one
      }
    }
    throw new InvalidKeySpecException("the private key is not RSA, EC or EdDSA");
  }

  /** PKCS #1 in PKCS #8: {@code SEQUENCE {0, rsaEncryption, OCTET STRING pkcs1}}. */
  static byte[] rsaToPkcs8(byte[] pkcs1) {
    return tlv(0x30, concat(new byte[] {2, 1, 0}, RSA_ALGORITHM, tlv(0x04, pkcs1)));
  }

  /** SEC 1 in PKCS #8, with the curve from the key's {@code [0]} parameters. */
  static byte[] ecToPkcs8(byte[] sec1) throws InvalidKeySpecException {
    byte[] curve = null;
    int[] at = {0};
    if ((sec1[0] & 0xff) != 0x30) {
      throw new InvalidKeySpecException("the EC private key is not a DER sequence");
    }
    readLength(sec1, at, 1);
    while (at[0] < sec1.length) {
      int tag = sec1[at[0]] & 0xff;
      int start = at[0];
      int length = readLength(sec1, at, at[0] + 1);
      if (tag == 0xa0) {
        curve = java.util.Arrays.copyOfRange(sec1, at[0], at[0] + length);
      }
      at[0] += length;
      if (at[0] <= start) {
        break;
      }
    }
    if (curve == null) {
      throw new InvalidKeySpecException("the EC private key does not name its curve");
    }
    return tlv(0x30, concat(new byte[] {2, 1, 0}, tlv(0x30, concat(EC_OID, curve)), tlv(0x04, sec1)));
  }

  /** Reads the length at {@code from}; leaves {@code at[0]} at the content's start. */
  private static int readLength(byte[] der, int[] at, int from) throws InvalidKeySpecException {
    if (from >= der.length) {
      throw new InvalidKeySpecException("the EC private key is cut short");
    }
    int first = der[from] & 0xff;
    int pos = from + 1;
    int length;
    if (first < 0x80) {
      length = first;
    } else {
      int bytes = first & 0x7f;
      if (bytes == 0 || bytes > 3 || pos + bytes > der.length) {
        throw new InvalidKeySpecException("the EC private key has a wrong length");
      }
      length = 0;
      for (int i = 0; i < bytes; i++) {
        length = (length << 8) | (der[pos++] & 0xff);
      }
    }
    if (pos + length > der.length) {
      throw new InvalidKeySpecException("the EC private key is cut short");
    }
    at[0] = pos;
    return length;
  }

  private static byte[] tlv(int tag, byte[] content) {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    out.write(tag);
    int n = content.length;
    if (n < 0x80) {
      out.write(n);
    } else if (n < 0x100) {
      out.write(0x81);
      out.write(n);
    } else if (n < 0x10000) {
      out.write(0x82);
      out.write(n >> 8);
      out.write(n);
    } else {
      out.write(0x83);
      out.write(n >> 16);
      out.write(n >> 8);
      out.write(n);
    }
    out.writeBytes(content);
    return out.toByteArray();
  }

  private static byte[] concat(byte[]... parts) {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    for (byte[] p : parts) {
      out.writeBytes(p);
    }
    return out.toByteArray();
  }

  private static byte[] hex(String s) {
    return java.util.HexFormat.of().parseHex(s);
  }
}
