Feature: OpenCode live artifact provider configuration

  Scenario: Apply the configured OpenRouter endpoint to OpenCode
    Given an OpenCode live fixture uses the supplied OpenRouter endpoint
    When its provider configuration is serialized
    Then provider.openrouter.options.baseURL contains that endpoint
    And the fixture does not add an API key to the provider options

  Scenario: Use the OpenAI-compatible adapter for a custom OpenRouter endpoint
    Given an OpenCode live fixture uses a custom OpenAI-compatible endpoint
    When its provider configuration is serialized
    Then provider.openrouter.npm is `@ai-sdk/openai-compatible`
    And the configured model ID remains unchanged

  Scenario: Keep the native adapter for the real OpenRouter endpoint
    Given an OpenCode live fixture uses the real OpenRouter endpoint
    When its provider configuration is serialized
    Then provider.openrouter.npm is unset

  Scenario: Register the configured OpenRouter model under its upstream ID
    Given an OpenCode live fixture uses the model `openrouter/deepseek-v4.1-flash`
    When its provider configuration is serialized
    Then provider.openrouter.models contains `deepseek-v4.1-flash`
    And provider.openrouter.models does not contain a tilde-prefixed model ID
