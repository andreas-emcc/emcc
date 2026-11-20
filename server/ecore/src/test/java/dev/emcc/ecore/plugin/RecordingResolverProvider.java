package dev.emcc.ecore.plugin;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.net.spi.InetAddressResolver;
import java.net.spi.InetAddressResolverProvider;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.stream.Stream;

/**
 * A name resolver for the tests (registered in {@code META-INF/services}): it resolves {@link #HOST}
 * to the loopback address and records the thread that asked, and hands every other name to the
 * JDK's own resolver. So a test can see on which thread the HTTP client looks up a host.
 */
public final class RecordingResolverProvider extends InetAddressResolverProvider {

  /** The test host name; resolves to 127.0.0.1. */
  public static final String HOST = "resolver-probe.test";

  /** The names of the threads that resolved {@link #HOST}. */
  public static final LinkedBlockingQueue<String> THREADS = new LinkedBlockingQueue<>();

  @Override
  public InetAddressResolver get(Configuration configuration) {
    InetAddressResolver builtin = configuration.builtinResolver();
    return new InetAddressResolver() {
      @Override
      public Stream<InetAddress> lookupByName(String host, LookupPolicy policy) throws UnknownHostException {
        if (HOST.equalsIgnoreCase(host)) {
          THREADS.add(Thread.currentThread().getName());
          return Stream.of(InetAddress.getByAddress(HOST, new byte[] {127, 0, 0, 1}));
        }
        return builtin.lookupByName(host, policy);
      }

      @Override
      public String lookupByAddress(byte[] address) throws UnknownHostException {
        return builtin.lookupByAddress(address);
      }
    };
  }

  @Override
  public String name() {
    return "emc2 test resolver";
  }
}
