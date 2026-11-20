package dev.emcc.ecore;

import static com.tngtech.archunit.core.domain.JavaCall.Predicates.target;
import static com.tngtech.archunit.base.DescribedPredicate.not;
import static com.tngtech.archunit.core.domain.JavaClass.Predicates.assignableTo;
import static com.tngtech.archunit.core.domain.JavaClass.Predicates.resideInAPackage;
import static com.tngtech.archunit.core.domain.JavaClass.Predicates.resideInAnyPackage;
import static com.tngtech.archunit.core.domain.properties.HasOwner.Predicates.With.owner;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.lang.ArchCondition;
import com.tngtech.archunit.lang.ConditionEvents;
import com.tngtech.archunit.lang.SimpleConditionEvent;
import java.time.Duration;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ForkJoinPool;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import org.jspecify.annotations.NullMarked;
import org.junit.jupiter.api.Test;

/** Architecture rules for ECore that the build enforces (CLAUDE.md section 4, ADR-0002). */
class ArchitectureTest {

  private static final JavaClasses ECORE =
      new ClassFileImporter()
          .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
          .importPackages("dev.emcc.ecore");

  @Test
  void ecoreDoesNotUseSpring() {
    noClasses()
        .should()
        .dependOnClassesThat()
        .resideInAnyPackage("org.springframework..", "dev.emcc.app..")
        .because("Spring is only allowed in server/app (ADR-0002)")
        .check(ECORE);
  }

  @Test
  void onlyTheWorkerRuntimeCreatesThreadsOrExecutors() {
    noClasses()
        .that()
        .resideOutsideOfPackage("dev.emcc.ecore.runtime..")
        .should()
        .dependOnClassesThat()
        .belongToAnyOf(
            Thread.Builder.class,
            ThreadFactory.class,
            Executors.class,
            ExecutorService.class,
            ThreadPoolExecutor.class,
            ScheduledThreadPoolExecutor.class,
            ForkJoinPool.class)
        .orShould()
        .callConstructorWhere(target(owner(assignableTo(Thread.class))))
        .orShould()
        .callMethod(Thread.class, "ofVirtual")
        .orShould()
        .callMethod(Thread.class, "ofPlatform")
        .orShould()
        .callMethod(Thread.class, "startVirtualThread", Runnable.class)
        .because("virtual threads and executors are created only inside ECore's worker runtime (agents/cda.md, rule C1)")
        .check(ECORE);
  }

  @Test
  void onlyThePluginHostUsesTheSdkBeyondTheModel() {
    noClasses()
        .that()
        .resideOutsideOfPackage("dev.emcc.ecore.plugin..")
        .should()
        .dependOnClassesThat(resideInAPackage("dev.emcc.sdk..")
            .and(not(resideInAnyPackage("dev.emcc.sdk.model..", "dev.emcc.sdk.json.."))))
        .because("ECore uses the SDK's data model everywhere, but its plugin interfaces only in the plugin host, "
            + "which maps them onto ECore's own runtime (T-015)")
        .check(ECORE);
  }

  @Test
  void nothingSleeps() {
    noClasses()
        .should()
        .callMethod(Thread.class, "sleep", long.class)
        .orShould()
        .callMethod(Thread.class, "sleep", Duration.class)
        .because("every wait has a timeout and a purpose; sleeping only hides timing problems (rule C5)")
        .check(ECORE);
  }

  @Test
  void everyPackageIsNullMarked() {
    classes()
        .should(beInANullMarkedPackage())
        .because("the null-handling rule is JSpecify @NullMarked in every package")
        .check(ECORE);
  }

  private static ArchCondition<JavaClass> beInANullMarkedPackage() {
    return new ArchCondition<>("be in a package annotated with @NullMarked") {
      @Override
      public void check(JavaClass javaClass, ConditionEvents events) {
        boolean marked = javaClass.getPackage().isAnnotatedWith(NullMarked.class);
        events.add(
            new SimpleConditionEvent(
                javaClass,
                marked,
                javaClass.getPackageName() + " has no package-info.java with @NullMarked"));
      }
    };
  }
}
