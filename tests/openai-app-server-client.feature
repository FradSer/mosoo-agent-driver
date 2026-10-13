Feature: OpenAI app-server notification backpressure

  Scenario: Wait for a burst write callback after draining accepted notifications
    Given the fake app-server writes a notification burst with a completion marker
    When the client drains the accepted notifications below the queue limit
    Then the handled notification count remains bounded by the queue limit
    And the completion marker is observed within a bounded readiness wait

  Scenario: Preserve queue overflow handling for oversized notification bursts
    Given the fake app-server writes a notification burst above the queue limit
    When the client drains the accepted notifications
    Then the drain rejects with the queue limit error
    And exactly one protocol error is reported
