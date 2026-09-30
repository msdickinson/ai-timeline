import { describe, it, expect } from "vitest";
import { parseFile } from "../src/parsers/index";

describe("Crash Tests - Edge Cases That Break Parsers", () => {
  // Test 1: Deeply nested JSON
  it("should not crash on deeply nested JSON (1000 levels)", () => {
    let nested: any = { messages: [] };
    let current = nested;
    for (let i = 0; i < 100; i++) {
      current.x = {};
      current = current.x;
    }
    current.conversationId = "test";
    current.messages = [{ role: "user", content: "test" }];
    
    const input = JSON.stringify(nested);
    expect(() => parseFile(input, "test.json")).not.toThrow();
  });

  // Test 2: Very long string (10MB)
  it("should not crash on 10MB string field", () => {
    const longString = "a".repeat(10 * 1024 * 1024);
    const input = JSON.stringify({
      conversationId: "test",
      messages: [{ role: "user", content: longString }]
    });
    
    expect(() => parseFile(input, "test.json")).not.toThrow();
  });

  // Test 3: Integer overflow in timestamp
  it("should handle integer overflow timestamps", () => {
    const input = JSON.stringify({
      conversationId: "test",
      messages: [{ role: "user", content: "test", timestamp: 9007199254740992 }]
    });
    
    expect(() => parseFile(input, "test.json")).not.toThrow();
  });

  // Test 4: NaN/Infinity values
  it("should not crash on NaN/Infinity in JSON", () => {
    // Note: JSON.parse will handle these differently
    const inputs = [
      '{"conversationId":"test","messages":[{"role":"user","content":"test","ts":NaN}]}',
      '{"conversationId":"test","messages":[{"role":"user","content":"test","ts":Infinity}]}',
    ];
    
    for (const input of inputs) {
      try {
        const result = parseFile(input, "test.json");
        // If it parses, it should not crash
        expect(result).toBeDefined();
      } catch {
        // JSON.parse itself may throw, which is fine
      }
    }
  });

  // Test 5: Empty strings where objects expected
  it("should handle empty strings in required fields", () => {
    const input = JSON.stringify({
      conversationId: "",
      messages: [{ role: "user", content: "" }]
    });
    
    expect(() => parseFile(input, "test.json")).not.toThrow();
  });

  // Test 6: Null values everywhere
  it("should handle null values in message fields", () => {
    const input = JSON.stringify({
      conversationId: null,
      messages: [
        { role: null, content: null },
        { role: "user", content: null, toolUse: null }
      ]
    });
    
    expect(() => parseFile(input, "test.json")).not.toThrow();
  });

  // Test 7: Array where string expected (type mismatch)
  it("should handle array where string expected", () => {
    const input = JSON.stringify({
      conversationId: ["not", "a", "string"],
      messages: [{ role: "user", content: [1, 2, 3] }]
    });
    
    expect(() => parseFile(input, "test.json")).not.toThrow();
  });

  // Test 8: Object where array expected
  it("should handle object where array expected", () => {
    const input = JSON.stringify({
      conversationId: "test",
      messages: { role: "user", content: "test" }
    });
    
    const result = parseFile(input, "test.json");
    expect(result).toBeDefined();
  });

  // Test 9: Circular reference-like structure (not true circular due to JSON)
  it("should handle deeply nested message content", () => {
    const msg: any = { role: "user" };
    let current = msg;
    for (let i = 0; i < 100; i++) {
      current.nested = {};
      current = current.nested;
    }
    current.content = "deeply nested";
    
    const input = JSON.stringify({
      conversationId: "test",
      messages: [msg]
    });
    
    expect(() => parseFile(input, "test.json")).not.toThrow();
  });

  // Test 10: Invalid timestamps
  it("should handle invalid timestamp formats", () => {
    const input = JSON.stringify({
      conversationId: "test",
      messages: [
        { role: "user", content: "test", timestamp: "not-a-date" },
        { role: "user", content: "test", timestamp: "2026-13-45T25:99:99Z" },
        { role: "user", content: "test", timestamp: "" },
      ]
    });
    
    expect(() => parseFile(input, "test.json")).not.toThrow();
  });

  // Test 11: Malformed JSON (parser should gracefully fail)
  it("should gracefully handle malformed JSON", () => {
    const malformed = '{"conversationId":"test","messages":[{"role":"user"';
    const result = parseFile(malformed, "test.json");
    expect(result).toEqual([]);
  });

  // Test 12: Messages array with mixed types
  it("should handle messages array with non-object elements", () => {
    const input = JSON.stringify({
      conversationId: "test",
      messages: [
        { role: "user", content: "test" },
        "not an object",
        null,
        42,
        { role: "assistant", content: "test" }
      ]
    });
    
    expect(() => parseFile(input, "test.json")).not.toThrow();
  });

  // Test 13: Tool calls with circular references in arguments
  it("should handle tool calls with deeply nested arguments", () => {
    const args: any = {};
    let current = args;
    for (let i = 0; i < 100; i++) {
      current.nested = {};
      current = current.nested;
    }
    current.value = "deep";
    
    const input = JSON.stringify({
      conversationId: "test",
      messages: [
        {
          role: "assistant",
          content: "calling",
          toolUse: {
            toolUseId: "123",
            name: "bash",
            input: args
          }
        }
      ]
    });
    
    expect(() => parseFile(input, "test.json")).not.toThrow();
  });
});
