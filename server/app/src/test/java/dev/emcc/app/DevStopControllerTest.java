package dev.emcc.app;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.file.Path;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

/** Who may use the development stop endpoint. The stopper is a mock, so nothing here stops the server. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
@ActiveProfiles(LoginConfiguration.DEV_PROFILE)
@DirtiesContext // closes this class's server before its temporary folder is deleted
class DevStopControllerTest {

  /** Deleted by JUnit after the class, once {@code @DirtiesContext} has closed the server that uses it. */
  @TempDir static Path folder;

  @MockitoBean private ServerStopper stopper;

  @DynamicPropertySource
  static void dataDirectory(DynamicPropertyRegistry registry) {
    registry.add("emc2.data.directory", () -> folder.toString());
  }

  @Autowired private WebApplicationContext context;
  private MockMvc mvc;

  @BeforeEach
  void mockMvc() {
    mvc = MockMvcBuilders.webAppContextSetup(context).build();
  }

  @ParameterizedTest
  @ValueSource(strings = {"192.0.2.10", "10.1.2.3", "2001:db8::1"})
  void refusesCallersOnOtherMachines(String address) throws Exception {
    mvc.perform(post(DevStopController.PATH).with(request -> {
      request.setRemoteAddr(address);
      return request;
    })).andExpect(status().isForbidden());

    verifyNoInteractions(stopper);
  }

  @ParameterizedTest
  @ValueSource(strings = {"127.0.0.1", "127.0.0.2", "::1", "0:0:0:0:0:0:0:1", "::ffff:127.0.0.1"})
  void acceptsEveryLoopbackForm(String address) throws Exception {
    mvc.perform(post(DevStopController.PATH).with(request -> {
      request.setRemoteAddr(address);
      return request;
    })).andExpect(status().isAccepted());

    verify(stopper).stopLater(DevStopController.PATH + " from " + address);
  }

  @Test
  void refusesRequestsFromAWebPage() throws Exception {
    mvc.perform(post(DevStopController.PATH).header(HttpHeaders.ORIGIN, "http://127.0.0.1:8080"))
        .andExpect(status().isForbidden());

    verifyNoInteractions(stopper);
  }

  @Test
  void onlyPostStops() throws Exception {
    mvc.perform(get(DevStopController.PATH)).andExpect(status().isMethodNotAllowed());

    verifyNoInteractions(stopper);
  }
}
