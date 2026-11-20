package dev.emcc.ecore.plugin;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.UnixDomainSocketAddress;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

class SocketAddressTextTest {

  private static InetAddress ip(String name, int... bytes) throws Exception {
    byte[] b = new byte[bytes.length];
    for (int i = 0; i < bytes.length; i++) {
      b[i] = (byte) bytes[i];
    }
    return InetAddress.getByAddress(name, b);
  }

  @Test
  void anIpv4AddressHasNoSlash() throws Exception {
    // The ITA's finding (2026-10-27): Java's own text is "/127.0.0.1:55144".
    assertThat(SocketAddressText.of(new InetSocketAddress(ip(null, 127, 0, 0, 1), 55144))).isEqualTo("127.0.0.1:55144");
    assertThat(SocketAddressText.of(new InetSocketAddress(55144))).isIn("0.0.0.0:55144", "[::]:55144");
    assertThat(SocketAddressText.of(new InetSocketAddress(ip(null, 0, 0, 0, 0), 5000))).isEqualTo("0.0.0.0:5000");
  }

  @Test
  void anIpv6AddressIsShortenedInBrackets() throws Exception {
    int[] loopback = new int[16];
    loopback[15] = 1;
    assertThat(SocketAddressText.of(new InetSocketAddress(ip(null, loopback), 5000))).isEqualTo("[::1]:5000");
    assertThat(SocketAddressText.of(new InetSocketAddress(ip(null, new int[16]), 5000))).isEqualTo("[::]:5000");
    InetAddress scoped = Inet6Address.getByAddress(null, new byte[] {(byte) 0xfe, (byte) 0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1}, 3);
    assertThat(SocketAddressText.of(new InetSocketAddress(scoped, 5000))).isEqualTo("[fe80::1%3]:5000");
    assertThat(SocketAddressText.of(new InetSocketAddress(InetAddress.getByName("::1"), 5000))).as("a literal is no name").isEqualTo("[::1]:5000");
  }

  @Test
  void theLongestRunOfZeroGroupsIsShortenedAndTheFirstOfEqualOnes() {
    assertThat(SocketAddressText.shortened("2001:db8:0:0:1:0:0:0")).isEqualTo("2001:db8:0:0:1::");
    assertThat(SocketAddressText.shortened("2001:db8:0:0:1:0:0:1")).isEqualTo("2001:db8::1:0:0:1");
    assertThat(SocketAddressText.shortened("2001:db8:0:1:1:1:1:1")).as("one zero group stays").isEqualTo("2001:db8:0:1:1:1:1:1");
    assertThat(SocketAddressText.shortened("0:0:0:0:0:0:0:0")).isEqualTo("::");
    assertThat(SocketAddressText.shortened("fe80:0:0:0:0:0:0:1%eth0")).isEqualTo("fe80::1%eth0");
  }

  @Test
  void anIpv4MappedAddressKeepsHexGroupsUnlessJavaMadeItIpv4() throws Exception {
    int[] mapped = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 1, 2, 3, 4};
    byte[] bytes = new byte[16];
    for (int i = 0; i < 16; i++) {
      bytes[i] = (byte) mapped[i];
    }
    assertThat(SocketAddressText.of(new InetSocketAddress(Inet6Address.getByAddress(null, bytes, -1), 5000))).isEqualTo("[::ffff:102:304]:5000");
    assertThat(SocketAddressText.of(new InetSocketAddress(ip(null, mapped), 5000))).as("Java's usual IPv4").isEqualTo("1.2.3.4:5000");
  }

  @Test
  void theNameThePluginGaveComesAfterTheAddressWithoutALookup() throws Exception {
    assertThat(SocketAddressText.of(new InetSocketAddress(ip("tak.example", 10, 0, 0, 5), 8089))).isEqualTo("10.0.0.5:8089 (tak.example)");
    assertThat(SocketAddressText.of(new InetSocketAddress(InetAddress.getLoopbackAddress(), 4242)))
        .isIn("127.0.0.1:4242 (localhost)", "[::1]:4242 (localhost)");
    assertThat(SocketAddressText.of(InetSocketAddress.createUnresolved("tak.example", 8089))).isEqualTo("tak.example:8089");
    int[] documentation = new int[16];
    documentation[0] = 0x20;
    documentation[1] = 0x01;
    documentation[2] = 0x0d;
    documentation[3] = 0xb8;
    documentation[15] = 1;
    assertThat(SocketAddressText.of(new InetSocketAddress(ip("tak.example", documentation), 8089))).isEqualTo("[2001:db8::1]:8089 (tak.example)");
  }

  @Test
  void aNameThatOnlyLooksLikeAnAddressIsShownButTheAddressesOwnTextIsNot() throws Exception {
    assertThat(SocketAddressText.of(new InetSocketAddress(ip("10.0.0.9", 192, 168, 1, 1), 80))).isEqualTo("192.168.1.1:80 (10.0.0.9)");
    assertThat(SocketAddressText.of(new InetSocketAddress(ip("192.168.1.1", 192, 168, 1, 1), 80))).isEqualTo("192.168.1.1:80");
    int[] loopback = new int[16];
    loopback[15] = 1;
    assertThat(SocketAddressText.of(new InetSocketAddress(ip("::1", loopback), 80))).as("shortened").isEqualTo("[::1]:80");
    assertThat(SocketAddressText.of(new InetSocketAddress(ip("0:0:0:0:0:0:0:1", loopback), 80))).as("Java's full form").isEqualTo("[::1]:80");
  }

  @Test
  void anyOtherKindOfAddressIsAsJavaWritesIt() {
    UnixDomainSocketAddress unix = UnixDomainSocketAddress.of(Path.of("emc2.sock"));
    assertThat(SocketAddressText.of(unix)).isEqualTo(unix.toString());
  }
}
