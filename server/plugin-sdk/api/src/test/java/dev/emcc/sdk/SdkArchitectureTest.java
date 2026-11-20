package dev.emcc.sdk;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;

import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.lang.ArchCondition;
import com.tngtech.archunit.lang.ConditionEvents;
import com.tngtech.archunit.lang.SimpleConditionEvent;
import org.jspecify.annotations.NullMarked;
import org.junit.jupiter.api.Test;

/** Rules for the SDK itself (docs/plugins/sdk-v0.md, "Common principles"). */
class SdkArchitectureTest {

  private static final JavaClasses SDK =
      new ClassFileImporter().withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS).importPackages("dev.emcc.sdk");

  @Test
  void dependsOnlyOnTheJdkAndJSpecify() {
    classes()
        .should()
        .onlyDependOnClassesThat()
        .resideInAnyPackage("java..", "javax.net.ssl..", "dev.emcc.sdk..", "org.jspecify.annotations..", "net.sf.geographiclib..")
        .because("plugins see only the SDK (ADR-0003); the SDK has no third-party dependencies but JSpecify and, inside dev.emcc.sdk.geo, GeographicLib-Java (javax.net.ssl: the JDK's TLS factories for connection tasks, SDK 1.2.0; GeographicLib: CR-0025 part 7)")
        .check(SDK);
  }

  @Test
  void geographicLibStaysInsideTheGeoPackageAndBehindItsTypes() {
    com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses()
        .that()
        .resideOutsideOfPackage("dev.emcc.sdk.geo")
        .should()
        .dependOnClassesThat()
        .resideInAPackage("net.sf.geographiclib..")
        .because("the library stays behind the SDK's own types, so it can be replaced without a change for plugins (CR-0025 part 7)")
        .check(SDK);
    com.tngtech.archunit.lang.syntax.ArchRuleDefinition.methods()
        .that()
        .arePublic()
        .and()
        .areDeclaredInClassesThat()
        .resideInAPackage("dev.emcc.sdk.geo")
        .should()
        .notHaveRawReturnType(com.tngtech.archunit.base.DescribedPredicate.describe("a GeographicLib type", (JavaClass t) -> t.getPackageName().startsWith("net.sf.geographiclib")))
        .because("plugins never see GeographicLib's types (R3)")
        .check(SDK);
    var library = com.tngtech.archunit.base.DescribedPredicate.describe("a GeographicLib type", (JavaClass t) -> t.getPackageName().startsWith("net.sf.geographiclib"));
    com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noMethods()
        .that().arePublic().and().areDeclaredInClassesThat().resideInAPackage("dev.emcc.sdk.geo")
        .should().haveRawParameterTypes(com.tngtech.archunit.base.DescribedPredicate.anyElementThat(library))
        .because("plugins never pass GeographicLib's types (R3)")
        .check(SDK);
    com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noConstructors()
        .that().arePublic().and().areDeclaredInClassesThat().resideInAPackage("dev.emcc.sdk.geo")
        .should().haveRawParameterTypes(com.tngtech.archunit.base.DescribedPredicate.anyElementThat(library))
        .allowEmptyShould(true)
        .because("plugins never pass GeographicLib's types (R3)")
        .check(SDK);
    com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noFields()
        .that().arePublic().and().areDeclaredInClassesThat().resideInAPackage("dev.emcc.sdk.geo")
        .should().haveRawType(library)
        .allowEmptyShould(true)
        .because("plugins never see GeographicLib's types (R3)")
        .check(SDK);
    com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses()
        .that().resideInAPackage("dev.emcc.sdk.geo")
        .should().beAssignableTo(library)
        .because("the SDK's types do not extend GeographicLib's (R3)")
        .check(SDK);
  }

  @Test
  void doesNotStartThreads() {
    com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses()
        .should()
        .dependOnClassesThat()
        .resideInAnyPackage("java.util.concurrent..")
        .orShould()
        .dependOnClassesThat()
        .areAssignableTo(Thread.class)
        .because("the SDK only describes; ECore runs (rule C1)")
        .check(SDK);
  }

  @Test
  void everyPackageIsNullMarked() {
    classes()
        .should(new ArchCondition<JavaClass>("be in a package annotated with @NullMarked") {
          @Override
          public void check(JavaClass c, ConditionEvents events) {
            events.add(new SimpleConditionEvent(c, c.getPackage().isAnnotatedWith(NullMarked.class), c.getPackageName() + " is not @NullMarked"));
          }
        })
        .check(SDK);
  }
}
