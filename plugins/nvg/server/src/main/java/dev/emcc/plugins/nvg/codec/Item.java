package dev.emcc.plugins.nvg.codec;

import dev.emcc.sdk.model.SecurityLabel;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * One NVG shape, as read from a document or as it is written: the values as text, unconverted.
 * The mapping ({@code mapping}) checks and converts them. Immutable, so it may travel in messages.
 *
 * @param kind the element
 * @param uri the item's {@code uri}
 * @param attributes the element's other NVG attributes as written ({@code label}, {@code symbol}, {@code x}, {@code points}, ...)
 * @param content a {@code text}'s content, else {@code null}
 * @param textInfo the {@code textInfo} element, or {@code null}
 * @param timeStamp the {@code TimeStamp} as written, or {@code null}
 * @param timeBegin the {@code TimeSpan}'s {@code begin}, or {@code null}
 * @param timeEnd the {@code TimeSpan}'s {@code end}, or {@code null}
 * @param label the item's own STANAG 4774 label (in {@code metadata} or {@code extension}); when reading, the
 *     enclosing composite's or group's when the item has none; {@code null} for none
 * @param labelUnreadable a label was there but could not be read (counted "label not understood")
 * @param extendedData the {@code ExtendedData} element as XML text, or {@code null}
 * @param extension the content of {@code metadata} and {@code extension} other than the label, as XML text, or {@code null}
 * @param foreign elements of other namespaces directly inside the item, as XML text, or {@code null}
 * @param excludes an area's holes, in order
 * @param groupPath the labels of the enclosing {@code g} elements, from the root
 * @param compositeUri the enclosing {@code composite}'s {@code uri}, or {@code null}
 * @param compositeSymbol the enclosing {@code composite}'s {@code symbol}, or {@code null}
 * @param part the item's place in its composite, from 1; 0 outside a composite
 */
public record Item(
    Kind kind,
    String uri,
    Map<String, String> attributes,
    @Nullable String content,
    @Nullable String textInfo,
    @Nullable String timeStamp,
    @Nullable String timeBegin,
    @Nullable String timeEnd,
    @Nullable SecurityLabel label,
    boolean labelUnreadable,
    @Nullable String extendedData,
    @Nullable String extension,
    @Nullable String foreign,
    List<Ring> excludes,
    List<String> groupPath,
    @Nullable String compositeUri,
    @Nullable String compositeSymbol,
    int part) {

  public Item {
    Objects.requireNonNull(kind, "kind");
    Objects.requireNonNull(uri, "uri");
    attributes = Map.copyOf(attributes);
    excludes = List.copyOf(excludes);
    groupPath = List.copyOf(groupPath);
  }

  /** An attribute's value as written, or {@code null}. */
  public @Nullable String attribute(String name) {
    return attributes.get(name);
  }

  /** A builder, for the reader, the mapping and tests. */
  public static Builder builder(Kind kind, String uri) {
    return new Builder(kind, uri);
  }

  /** A builder that starts from this item. */
  public Builder toBuilder() {
    Builder b = new Builder(kind, uri);
    b.attributes.putAll(attributes);
    b.content = content;
    b.textInfo = textInfo;
    b.timeStamp = timeStamp;
    b.timeBegin = timeBegin;
    b.timeEnd = timeEnd;
    b.label = label;
    b.labelUnreadable = labelUnreadable;
    b.extendedData = extendedData;
    b.extension = extension;
    b.foreign = foreign;
    b.excludes.addAll(excludes);
    b.groupPath.addAll(groupPath);
    b.compositeUri = compositeUri;
    b.compositeSymbol = compositeSymbol;
    b.part = part;
    return b;
  }

  /** Builds an {@link Item}; not thread-safe, used in one handler call. */
  public static final class Builder {
    private final Kind kind;
    private String uri;
    private final Map<String, String> attributes = new LinkedHashMap<>();
    private @Nullable String content;
    private @Nullable String textInfo;
    private @Nullable String timeStamp;
    private @Nullable String timeBegin;
    private @Nullable String timeEnd;
    private @Nullable SecurityLabel label;
    private boolean labelUnreadable;
    private @Nullable String extendedData;
    private @Nullable String extension;
    private @Nullable String foreign;
    private final List<Ring> excludes = new ArrayList<>();
    private final List<String> groupPath = new ArrayList<>();
    private @Nullable String compositeUri;
    private @Nullable String compositeSymbol;
    private int part;

    private Builder(Kind kind, String uri) {
      this.kind = kind;
      this.uri = uri;
    }

    public Builder uri(String value) {
      uri = value;
      return this;
    }

    /** Sets an attribute, or removes it for {@code null}. */
    public Builder attribute(String name, @Nullable String value) {
      if (value == null) {
        attributes.remove(name);
      } else {
        attributes.put(name, value);
      }
      return this;
    }

    public Builder content(@Nullable String value) {
      content = value;
      return this;
    }

    public Builder textInfo(@Nullable String value) {
      textInfo = value;
      return this;
    }

    public Builder timeStamp(@Nullable String value) {
      timeStamp = value;
      return this;
    }

    public Builder timeSpan(@Nullable String begin, @Nullable String end) {
      timeBegin = begin;
      timeEnd = end;
      return this;
    }

    public Builder label(@Nullable SecurityLabel value) {
      label = value;
      return this;
    }

    public Builder labelUnreadable(boolean value) {
      labelUnreadable = value;
      return this;
    }

    public Builder extendedData(@Nullable String value) {
      extendedData = value;
      return this;
    }

    public Builder extension(@Nullable String value) {
      extension = value;
      return this;
    }

    public Builder foreign(@Nullable String value) {
      foreign = value;
      return this;
    }

    public Builder exclude(Ring ring) {
      excludes.add(ring);
      return this;
    }

    public Builder groupPath(List<String> value) {
      groupPath.clear();
      groupPath.addAll(value);
      return this;
    }

    public Builder composite(@Nullable String uri, @Nullable String symbol, int place) {
      compositeUri = uri;
      compositeSymbol = symbol;
      part = place;
      return this;
    }

    public Item build() {
      return new Item(kind, uri, attributes, content, textInfo, timeStamp, timeBegin, timeEnd, label, labelUnreadable,
          extendedData, extension, foreign, excludes, groupPath, compositeUri, compositeSymbol, part);
    }
  }
}
