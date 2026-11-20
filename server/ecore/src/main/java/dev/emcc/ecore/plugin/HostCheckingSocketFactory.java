package dev.emcc.ecore.plugin;

import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.Socket;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

/**
 * The TLS socket factory a connection task gets from {@code TaskContext.tls(name)}: every socket
 * it makes checks that the peer's certificate names the host it connects to (HTTPS endpoint
 * identification), as a listener's connections do (owner, 2026-10-26). A task that needs another
 * check uses {@code sslContext(name)}.
 */
final class HostCheckingSocketFactory extends SSLSocketFactory {

  private final SSLSocketFactory delegate;

  HostCheckingSocketFactory(SSLSocketFactory delegate) {
    this.delegate = delegate;
  }

  private static Socket checked(Socket socket) {
    if (socket instanceof SSLSocket ssl) {
      SSLParameters parameters = ssl.getSSLParameters();
      parameters.setEndpointIdentificationAlgorithm("HTTPS");
      ssl.setSSLParameters(parameters);
    }
    return socket;
  }

  @Override
  public String[] getDefaultCipherSuites() {
    return delegate.getDefaultCipherSuites();
  }

  @Override
  public String[] getSupportedCipherSuites() {
    return delegate.getSupportedCipherSuites();
  }

  /** Unconnected: the host it is checked against is the one {@code connect} names. */
  @Override
  public Socket createSocket() throws IOException {
    return checked(delegate.createSocket());
  }

  @Override
  public Socket createSocket(Socket socket, String host, int port, boolean autoClose) throws IOException {
    return checked(delegate.createSocket(socket, host, port, autoClose));
  }

  @Override
  public Socket createSocket(Socket socket, InputStream consumed, boolean autoClose) throws IOException {
    return checked(delegate.createSocket(socket, consumed, autoClose));
  }

  @Override
  public Socket createSocket(String host, int port) throws IOException {
    return checked(delegate.createSocket(host, port));
  }

  @Override
  public Socket createSocket(String host, int port, InetAddress localHost, int localPort) throws IOException {
    return checked(delegate.createSocket(host, port, localHost, localPort));
  }

  @Override
  public Socket createSocket(InetAddress host, int port) throws IOException {
    return checked(delegate.createSocket(host, port));
  }

  @Override
  public Socket createSocket(InetAddress address, int port, InetAddress localAddress, int localPort) throws IOException {
    return checked(delegate.createSocket(address, port, localAddress, localPort));
  }
}
