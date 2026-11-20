package dev.emcc.plugins.basemapwms;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.Bytes;
import java.util.List;
import org.junit.jupiter.api.Test;

/** What is taken from a capabilities document (brief function 1) and that it is read safely (criterion 15). */
class CapabilitiesParserTest {

  @Test
  void aNamedLayerInheritsItsParentsProjectionsInVersion130() throws Exception {
    List<LayerInfo> layers = CapabilitiesParser.parse(WmsTestSupport.capabilities130());

    assertThat(layers).extracting(LayerInfo::name).containsExactly("land", "sea", "group", "child", "nested");
    assertThat(layers.get(0)).isEqualTo(new LayerInfo("land", "Land", List.of("EPSG:4326", "EPSG:3857", "EPSG:3413")));
    // a layer group is a layer like any other, and its children inherit from it and from the root
    assertThat(layers.get(2).projections()).containsExactly("EPSG:4326", "EPSG:3857", "EPSG:3031");
    assertThat(layers.get(3).projections()).containsExactly("EPSG:4326", "EPSG:3857", "EPSG:3031");
    assertThat(layers.get(3).title()).isEqualTo("A child");
    // a layer without a title shows its name; a layer without a name is not offered, its named child is
    assertThat(layers.get(4)).isEqualTo(new LayerInfo("nested", "nested", List.of("EPSG:4326", "EPSG:3857")));
  }

  @Test
  void version111SrsMayListSeveralCodesAndCodesAreUpperCase() throws Exception {
    List<LayerInfo> layers = CapabilitiesParser.parse(WmsTestSupport.capabilities111());

    assertThat(layers).extracting(LayerInfo::name).containsExactly("land", "sea");
    assertThat(layers.get(0).projections()).containsExactly("EPSG:4326", "EPSG:3857", "EPSG:3413");

    Bytes lower = Bytes.utf8("<WMS_Capabilities xmlns=\"http://www.opengis.net/wms\"><Capability><Layer><Name>a</Name><CRS>epsg:3413</CRS></Layer></Capability></WMS_Capabilities>");
    assertThat(CapabilitiesParser.parse(lower).getFirst().projections()).containsExactly("EPSG:3413");
  }

  private static Bytes doc(String doctype) {
    return Bytes.utf8("<?xml version=\"1.0\"?>\n" + doctype
        + "\n<WMT_MS_Capabilities version=\"1.1.1\"><Capability><Layer><Name>a</Name><SRS>EPSG:4326</SRS></Layer></Capability></WMT_MS_Capabilities>");
  }

  @Test
  void aBareDoctypeIsAcceptedAndItsDtdIsNeverLoaded() throws Exception {
    try (var listener = new java.net.ServerSocket(0, 1, java.net.InetAddress.getLoopbackAddress())) {
      listener.setSoTimeout(500);
      String url = "http://127.0.0.1:" + listener.getLocalPort() + "/WMS_MS_Capabilities.dtd";

      assertThat(CapabilitiesParser.parse(doc("<!DOCTYPE WMT_MS_Capabilities SYSTEM \"" + url + "\">"))).extracting(LayerInfo::name).containsExactly("a");
      assertThat(CapabilitiesParser.parse(doc("<!DOCTYPE WMT_MS_Capabilities PUBLIC \"-//x//DTD//EN\" \"" + url + "\">"))).hasSize(1);
      assertThat(CapabilitiesParser.parse(doc("<!DOCTYPE WMT_MS_Capabilities>"))).hasSize(1);
      assertThat(CapabilitiesParser.parse(doc("<!DOCTYPE WMT_MS_Capabilities []>"))).hasSize(1);
      assertThatThrownBy(listener::accept).as("nobody connected to the DTD's address").isInstanceOf(java.net.SocketTimeoutException.class);
    }
  }

  @Test
  void aDoctypeThatDeclaresSomethingIsRefused() {
    for (String doctype : List.of(
        "<!DOCTYPE WMT_MS_Capabilities [ <!ELEMENT WMT_MS_Capabilities ANY> ]>",
        "<!DOCTYPE WMT_MS_Capabilities [ <!ATTLIST WMT_MS_Capabilities version CDATA \"1\"> ]>",
        "<!DOCTYPE WMT_MS_Capabilities [ <!ENTITY e \"text\"> ]>",
        "<!DOCTYPE WMT_MS_Capabilities [ <!ENTITY % p SYSTEM \"http://127.0.0.1:1/p.dtd\"> %p; ]>",
        "<!DOCTYPE WMT_MS_Capabilities SYSTEM \"http://127.0.0.1:1/x.dtd\" [ <!NOTATION n SYSTEM \"x\"> ]>")) {
      boolean refused;
      try {
        CapabilitiesParser.parse(doc(doctype));
        refused = false;
      } catch (CapabilitiesParser.Unreadable e) {
        refused = true;
      }
      assertThat(refused).as("refused: " + doctype).isTrue();
    }
  }

  @Test
  void anUndeclaredEntityReferenceIsSkippedAndNothingIsLoadedForIt() throws Exception {
    Bytes undeclared = Bytes.utf8("<!DOCTYPE WMS_Capabilities SYSTEM \"http://127.0.0.1:1/x.dtd\"><WMS_Capabilities><Capability><Layer><Name>&xxe;</Name></Layer></Capability></WMS_Capabilities>");

    assertThat(CapabilitiesParser.parse(undeclared)).as("no layer: the entity has no text").isEmpty();
  }

  @Test
  void anExternalEntityIsRefused() {
    Bytes withEntity = Bytes.utf8("""
        <?xml version="1.0"?>
        <!DOCTYPE WMS_Capabilities [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
        <WMS_Capabilities version="1.3.0"><Capability><Layer><Name>&xxe;</Name></Layer></Capability></WMS_Capabilities>
        """);

    assertThatThrownBy(() -> CapabilitiesParser.parse(withEntity)).isInstanceOf(CapabilitiesParser.Unreadable.class);
  }

  @Test
  void aServiceExceptionAndOtherDocumentsAreNotCapabilities() {
    Bytes exception = Bytes.utf8("<ServiceExceptionReport version=\"1.3.0\"><ServiceException>Nope</ServiceException></ServiceExceptionReport>");

    assertThatThrownBy(() -> CapabilitiesParser.parse(exception)).isInstanceOf(CapabilitiesParser.Unreadable.class).hasMessageContaining("Nope");
    assertThatThrownBy(() -> CapabilitiesParser.parse(Bytes.utf8("<html/>"))).isInstanceOf(CapabilitiesParser.Unreadable.class);
    assertThatThrownBy(() -> CapabilitiesParser.parse(Bytes.utf8("not xml"))).isInstanceOf(CapabilitiesParser.Unreadable.class);
  }

  @Test
  void aDocumentWithoutLayersGivesNone() throws Exception {
    assertThat(CapabilitiesParser.parse(Bytes.utf8("<WMS_Capabilities><Capability/></WMS_Capabilities>"))).isEmpty();
  }
}
