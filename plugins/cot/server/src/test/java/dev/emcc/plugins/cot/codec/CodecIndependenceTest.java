package dev.emcc.plugins.cot.codec;

import static com.tngtech.archunit.core.domain.JavaClass.Predicates.resideInAnyPackage;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.tngtech.archunit.base.DescribedPredicate;
import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.lang.ArchRule;
import org.junit.jupiter.api.Test;

/**
 * Acceptance criterion 13: the CoT codec is a part of its own. It uses no listener, store,
 * settings, worker or timer type, and nothing of the plugin outside the codec (brief "Later:
 * outgoing", point 1), so that the outgoing side can use it without the incoming transport.
 *
 * <p>The rule is a whitelist: the codec may depend on the JDK, the XML API of the JDK, the SDK's
 * model and JSON types (the object content it maps to and from), and itself. Everything else
 * fails, so a new SDK type in the codec has to be argued for here.
 */
class CodecIndependenceTest {

  private static final String CODEC = "dev.emcc.plugins.cot.codec";

  private static final JavaClasses ALL = new ClassFileImporter().withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS).importPackages("dev.emcc.plugins.cot");

  private static ArchRule onlyTheAllowed(DescribedPredicate<JavaClass> subject) {
    return classes()
        .that(subject)
        .should()
        .onlyDependOnClassesThat()
        .resideInAnyPackage(
            CODEC,
            "java..",
            "javax.xml..",
            "org.w3c.dom..",
            "org.xml.sax..",
            "org.jspecify..",
            "dev.emcc.sdk.model..",
            "dev.emcc.sdk.json..")
        .as("the codec uses no listener, store, settings, worker, timer, document or plugin type, and nothing of the plugin outside the codec");
  }

  @Test
  void theCodecDependsOnlyOnTheJdkTheModelAndItself() {
    assertThat(ALL.that(resideInAnyPackage(CODEC))).as("the codec's classes").isNotEmpty();
    onlyTheAllowed(resideInAnyPackage(CODEC)).check(ALL);
  }

  @Test
  void theRuleWouldCatchAClassThatUsesListenersStoreAndWorkers() {
    // The worker uses the store, connection tasks and settings: the same rule must fail for it, or it checks nothing.
    assertThatThrownBy(() -> onlyTheAllowed(simpleName("Applier")).check(ALL)).isInstanceOf(AssertionError.class).hasMessageContaining("dev.emcc.sdk");
    assertThatThrownBy(() -> onlyTheAllowed(simpleName("TcpLinkTask")).check(ALL)).isInstanceOf(AssertionError.class).hasMessageContaining("dev.emcc.sdk.connection");
  }

  private static DescribedPredicate<JavaClass> simpleName(String name) {
    return DescribedPredicate.describe("named " + name, c -> c.getSimpleName().equals(name));
  }
}
