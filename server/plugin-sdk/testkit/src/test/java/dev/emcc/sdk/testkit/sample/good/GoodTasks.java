package dev.emcc.sdk.testkit.sample.good;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.connection.ConnectionRef;
import dev.emcc.sdk.connection.ConnectionSpec;
import dev.emcc.sdk.connection.ConnectionTask;
import dev.emcc.sdk.connection.ListenAddress;
import dev.emcc.sdk.connection.TaskContext;
import java.io.IOException;
import java.io.InputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;

/** SDK 1.2.0: connection tasks that follow the rules: sockets and name lookups only in task classes and their nested classes. */
public final class GoodTasks {

  private GoodTasks() {}

  public sealed interface TaskMsg extends Message permits Received, LinkUp {}

  public record Received(int length) implements TaskMsg {}

  /** A message may carry a task's handle, as it may carry a WorkerRef. */
  public record LinkUp(ConnectionRef<Message> task) implements TaskMsg {}

  /** A TCP server that starts one child per client; the per-client reader is a nested class. */
  public static final class Server implements ConnectionTask<Message> {
    private final ListenAddress at;

    public Server(ListenAddress at) {
      this.at = at;
    }

    @Override
    public void run(TaskContext<Message> task) throws IOException {
      try (var server = new ServerSocket()) {
        task.closeOnStop(server);
        server.bind(new InetSocketAddress(InetAddress.getByName(at.address()), at.port()));
        task.listening(server.getLocalSocketAddress());
        int clients = 0;
        while (!task.stopping()) {
          Socket client = server.accept();
          try {
            // The plugin numbers its children: client-1, client-2, ...
            task.startChild(ConnectionSpec.of("client-" + (++clients), Message.class), () -> new Reader(client));
          } catch (IllegalStateException atTheCap) {
            client.close();
            task.count("clients refused", 1);
          }
        }
      }
    }

    /** Nested in the task: may take the socket. */
    static final class Reader implements ConnectionTask<Message> {
      private final Socket socket;

      Reader(Socket socket) {
        this.socket = socket;
      }

      @Override
      public void run(TaskContext<Message> task) throws IOException {
        task.closeOnStop(socket);
        task.peer(socket.getRemoteSocketAddress());
        InputStream in = socket.getInputStream();
        byte[] buffer = new byte[4096];
        for (int n; (n = in.read(buffer)) >= 0; ) {
          task.count("bytes in", n);
        }
      }
    }

    /** A helper nested in the task that is not a task itself: may handle the socket too. */
    static final class Greeter {
      void greet(Socket socket) throws IOException {
        socket.getOutputStream().write(new byte[] {1});
      }
    }
  }

  /** A TCP client whose socket code sits in an anonymous class and a lambda inside the task. */
  public static final class Client implements ConnectionTask<Message> {
    private final String host;
    private final int port;

    public Client(String host, int port) {
      this.host = host;
      this.port = port;
    }

    @Override
    public void run(TaskContext<Message> task) throws Exception {
      java.util.concurrent.Callable<Socket> open = new java.util.concurrent.Callable<>() {
        @Override
        public Socket call() throws IOException {
          return new Socket(InetAddress.getByName(host), port);
        }
      };
      java.util.function.Supplier<InetSocketAddress> where = () -> new InetSocketAddress(host, port);
      try (Socket socket = task.closeOnStop(open.call())) {
        task.peer(socket.isConnected() ? socket.getRemoteSocketAddress() : where.get());
      }
    }
  }

  /** A UDP receiver: a DatagramSocket in the task. */
  public static final class Udp implements ConnectionTask<Message> {
    @Override
    public void run(TaskContext<Message> task) throws IOException {
      try (var socket = new DatagramSocket(new InetSocketAddress("127.0.0.1", 0))) {
        task.closeOnStop(socket);
        byte[] buffer = new byte[1500];
        var packet = new DatagramPacket(buffer, buffer.length);
        socket.receive(packet);
        task.count("packets in", 1);
      }
    }
  }
}
