package dev.emcc.plugins.fmv.out.render;

/**
 * fmv's own bitmap font for the data overlay (CR-0055 point 4: drawn by PCA-fmv, under the
 * project's licence; no third-party font, no AWT text): 5 × 7 glyphs for printable ASCII, and the
 * degree sign and the multiplication sign the overlay's text uses.
 *
 * <p>A glyph is seven rows, top to bottom; in a row, bit 4 is the leftmost of the five columns. The
 * table is one string, seven characters a glyph from the space on, each {@code '0'} plus the row's
 * bits (a string, since a plugin's constants hold no arrays).
 */
final class Glyphs {

  /** A glyph's width and height, pixels at scale 1. */
  static final int WIDTH = 5;
  static final int HEIGHT = 7;

  /** The advance from one character to the next, with a column of space. */
  static final int ADVANCE = WIDTH + 1;

  private static final String ASCII = ""
      + "00000004444404::00000:O::O:04?D>5N4HI248C3<BD8EB=4400000" // space ! " # $ % & '
      + "2488842842224804E>E40044O4400000<48000O00000000<<01248@0" // ( ) * + , - . /
      + ">ACEIA>4<4444>>A1248OO2421A>26:BO22O@N11A>68@NAA>O124888" // 0 1 2 3 4 5 6 7
      + ">AA>AA>>AA?12<0<<0<<00<<0<48248@84200O0O008421248>A12404" // 8 9 : ; < = > ?
      + ">A1=EE>>AAOAAANAANAAN>A@@@A>LBAAABLO@@N@@OO@@N@@@>A@GAA?" // @ A B C D E F G
      + "AAAOAAA>44444>72222B<ABDHDBA@@@@@@OAKEEAAAAAIECAA>AAAAA>" // H I J K L M N O
      + "NAAN@@@>AAAEB=NAANDBA?@@>11NO444444AAAAAA>AAAAA:4AAAEEE:" // P Q R S T U V W
      + "AA:4:AAAA:4444O1248@O>88888>0@84210>22222>4:A0000000000O" // X Y Z [ \ ] ^ _
      + "840000000>1?A?@@FIAAN00>@@A>11=CAA?00>AO@>698L8880?AA?1>" // ` a b c d e f g
      + "@@FIAAA40<444>20622B<@@BDHDB<44444>00JEEAA00FIAAA00>AAA>" // h i j k l m n o
      + "00NAN@@00=C?1100FI@@@00>@>1N88L889600AAAC=00AAA:400AAEE:" // p q r s t u v w
      + "00A:4:A00AA?1>00O248O244844244444448442448008E200"; // x y z { | } ~

  private static final String DEGREE = "<BB<000";
  private static final String TIMES = "0A:4:A0";
  private static final String UNKNOWN = "OAAAAAO";

  private Glyphs() {}

  /** Row {@code r} (0 at the top) of a character: printable ASCII, '°' and '×'; any other character is an empty box. */
  static int row(char c, int r) {
    if (r < 0 || r >= HEIGHT) {
      throw new IndexOutOfBoundsException("a glyph has rows 0 to " + (HEIGHT - 1) + ": " + r);
    }
    if (c >= 32 && c <= 126) {
      return ASCII.charAt((c - 32) * HEIGHT + r) - '0';
    }
    String g = switch (c) {
      case '°' -> DEGREE;
      case '×' -> TIMES;
      default -> UNKNOWN;
    };
    return g.charAt(r) - '0';
  }
}
