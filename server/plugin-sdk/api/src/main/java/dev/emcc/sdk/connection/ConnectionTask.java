package dev.emcc.sdk.connection;

import dev.emcc.sdk.Message;

/**
 * SDK 1.2.0: the code of a connection task (ADR-0036). ECore runs {@link #run} on a thread of its
 * own, a platform thread (CR-0027: on Windows, JDK-8334574 can leave a virtual thread blocked
 * writing a socket unwoken while another virtual thread reads it); it is the only plugin code that
 * may block (rule C6), and the only place where a plugin opens sockets. A task may write a socket
 * while its child task reads the same socket.
 *
 * <p><b>Write a task that holds sockets as a class</b>, not a lambda (a lambda is fine for a task without sockets): {@code PluginRules} allows the socket classes
 * and name resolution only in classes that implement this interface (and their nested classes),
 * and a lambda's body belongs to the class that defines it. A helper outside the task takes the
 * socket's streams, not the socket.
 *
 * <p>{@link #run} may return or throw; what follows is the spec's {@link Restart}. Register every
 * socket with {@link TaskContext#closeOnStop}, so that a blocked read ends when the task is
 * stopped. Return when {@link TaskContext#take} gives {@code null}.
 *
 * <pre>{@code
 * final class UdpReceiver implements ConnectionTask<Message> {
 *   private final ListenAddress at;
 *   private final WorkerRef<LinkMsg> link;
 *
 *   UdpReceiver(ListenAddress at, WorkerRef<LinkMsg> link) { this.at = at; this.link = link; }
 *
 *   @Override public void run(TaskContext<Message> task) throws IOException {
 *     try (var socket = new DatagramSocket(new InetSocketAddress(InetAddress.getByName(at.address()), at.port()))) {
 *       task.closeOnStop(socket);
 *       task.listening(socket.getLocalSocketAddress());
 *       byte[] buffer = new byte[64 * 1024];
 *       while (!task.stopping()) {
 *         var packet = new DatagramPacket(buffer, buffer.length);
 *         socket.receive(packet);
 *         task.count("packets in", 1);
 *         task.send(link, new LinkMsg.Received(Bytes.of(Arrays.copyOf(buffer, packet.getLength()))));
 *       }
 *     }
 *   }
 * }
 * }</pre>
 *
 * @param <I> the type of the items workers hand the task to send ({@link ConnectionRef#post})
 */
@FunctionalInterface
public interface ConnectionTask<I extends Message> {

  /**
   * The task's work. Blocking is allowed here. Return to end the task normally, or throw to fail
   * it; the spec's {@link Restart} decides whether ECore runs a fresh task again.
   */
  void run(TaskContext<I> task) throws Exception;
}
