// The network interface for the ITA's multicast tests (lib/multicast.mjs), as Java, and so ECore and
// the cot plugin, name it. Run with the JDK's single-file launcher: java MulticastInterface.java [name]
// Prints "<name> <IPv4 address>" for the named interface, or without a name for the first loopback
// interface that is up and supports multicast; otherwise "NONE <reason>". Exit code 0 either way.
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Collections;

public class MulticastInterface {
  public static void main(String[] args) throws Exception {
    if (args.length > 0) {
      NetworkInterface named = NetworkInterface.getByName(args[0]);
      if (named == null) {
        System.out.println("NONE no network interface is named " + args[0]);
      } else if (!named.isUp() || !named.supportsMulticast()) {
        System.out.println("NONE " + args[0] + " is not up or does not support multicast");
      } else {
        print(named);
      }
      return;
    }
    for (NetworkInterface n : Collections.list(NetworkInterface.getNetworkInterfaces())) {
      if (n.isLoopback() && n.isUp() && n.supportsMulticast() && ipv4(n) != null) {
        print(n);
        return;
      }
    }
    System.out.println("NONE no loopback interface supports multicast here (on Linux: ip link set lo multicast on)");
  }

  private static void print(NetworkInterface n) {
    InetAddress address = ipv4(n);
    System.out.println(address == null ? "NONE " + n.getName() + " has no IPv4 address" : n.getName() + " " + address.getHostAddress());
  }

  private static InetAddress ipv4(NetworkInterface n) {
    return Collections.list(n.getInetAddresses()).stream().filter(a -> a instanceof Inet4Address).findFirst().orElse(null);
  }
}
