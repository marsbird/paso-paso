import { describe, expect, test } from "vite-plus/test";
import { createTrace } from "../src/index.ts";
import type { TraceStep } from "../src/index.ts";

/** Helper: get the call stack frame names from a step. */
function frameNames(step: TraceStep): string[] {
  return step.contexts.map((c) => c.frame.name);
}

/** Helper: get the global context's first scope bindings. */
function globalBindings(step: TraceStep): Record<string, unknown> {
  return step.contexts[0].scopes[0]?.bindings ?? {};
}

describe("createTrace", () => {
  test("traces variable declarations", () => {
    const trace = createTrace(`
const x = 1;
const y = 2;
    `);

    expect(trace.error).toBeNull();
    expect(trace.steps).toHaveLength(2);
    expect(globalBindings(trace.steps[0])).toHaveProperty("x", 1);
    expect(globalBindings(trace.steps[1])).toHaveProperty("y", 2);
  });

  test("captures console.log output", () => {
    const trace = createTrace(`
console.log("hello");
console.log("world");
    `);

    expect(trace.error).toBeNull();
    const last = trace.steps[trace.steps.length - 1];
    expect(last.output).toEqual(["hello", "world"]);
  });

  test("call stack is visible during function execution", () => {
    const trace = createTrace(`
function greet(name) {
  return "Hello, " + name;
}
const result = greet("world");
    `);

    expect(trace.error).toBeNull();

    // Find the step where greet is on the call stack
    const duringGreet = trace.steps.find((s) => s.contexts.some((c) => c.frame.name === "greet"));
    expect(duringGreet).toBeDefined();
    expect(duringGreet!.contexts).toHaveLength(2);
    expect(duringGreet!.contexts[1].frame.name).toBe("greet");

    // After greet returns, call stack is back to just (global)
    const last = trace.steps[trace.steps.length - 1];
    expect(last.contexts).toHaveLength(1);
    expect(last.contexts[0].frame.name).toBe("(global)");
  });

  test("nested calls inside function bodies are visible on call stack", () => {
    const trace = createTrace(`
function add(a, b) {
  return a + b;
}
function multiply(x, y) {
  return x * y;
}
function square(c) {
  return multiply(c, c);
}
const sum = add(2, 3);
const squared = square(sum);
const result = multiply(squared, 4);
console.log(result);
    `);

    expect(trace.error).toBeNull();

    // Find the step where multiply is called from inside square
    const duringNestedMultiply = trace.steps.find((s) => {
      const names = frameNames(s);
      return names.length === 3 && names[1] === "square" && names[2] === "multiply";
    });
    expect(duringNestedMultiply).toBeDefined();

    // Find a step where multiply is called directly (not inside square)
    const duringDirectMultiply = trace.steps.find((s) => {
      const names = frameNames(s);
      return names.length === 2 && names[1] === "multiply";
    });
    expect(duringDirectMultiply).toBeDefined();

    // Final output
    const last = trace.steps[trace.steps.length - 1];
    expect(last.output).toEqual(["100"]);
  });

  test("nested function calls as arguments show both on call stack", () => {
    const trace = createTrace(`
function add(a, b) {
  return a + b;
}
function multiply(a, b) {
  return a * b;
}
const result = multiply(add(2, 3), 4);
console.log(result);
    `);

    expect(trace.error).toBeNull();

    const duringAdd = trace.steps.find((s) => s.contexts.some((c) => c.frame.name === "add"));
    expect(duringAdd).toBeDefined();

    const duringMultiply = trace.steps.find((s) =>
      s.contexts.some((c) => c.frame.name === "multiply"),
    );
    expect(duringMultiply).toBeDefined();

    const last = trace.steps[trace.steps.length - 1];
    expect(last.output).toEqual(["20"]);
  });

  test("evaluates arithmetic expressions", () => {
    const trace = createTrace(`
const a = 2 + 3;
const b = a * 4;
console.log(b);
    `);

    expect(trace.error).toBeNull();
    const last = trace.steps[trace.steps.length - 1];
    expect(last.output).toEqual(["20"]);
  });

  test("reports runtime errors", () => {
    const trace = createTrace(`
const x = undefinedVar;
    `);

    expect(trace.error).toContain("undefinedVar");
  });

  test("reports parse errors", () => {
    const trace = createTrace(`
const x = ;
    `);

    expect(trace.error).toBeDefined();
    expect(trace.steps).toHaveLength(0);
  });

  test("handles template literals", () => {
    const trace = createTrace(`
const name = "world";
console.log(\`Hello, \${name}!\`);
    `);

    expect(trace.error).toBeNull();
    const last = trace.steps[trace.steps.length - 1];
    expect(last.output).toEqual(["Hello, world!"]);
  });

  test("captures local variables in execution context", () => {
    const trace = createTrace(`
function greet(name) {
  const greeting = "Hello, " + name;
  return greeting;
}
const result = greet("world");
    `);

    expect(trace.error).toBeNull();

    // Find a step inside greet where greeting has been assigned
    const insideGreet = trace.steps.find((s) => {
      const greetCtx = s.contexts.find((c) => c.frame.name === "greet");
      return greetCtx && "greeting" in (greetCtx.scopes[0]?.bindings ?? {});
    });
    expect(insideGreet).toBeDefined();

    const greetCtx = insideGreet!.contexts.find((c) => c.frame.name === "greet")!;
    expect(greetCtx.scopes[0].bindings.greeting).toBe("Hello, world");
    expect(greetCtx.scopes[0].bindings.name).toBe("world");
  });

  test("execution contexts carry their own local bindings", () => {
    const trace = createTrace(`
function outer(x) {
  function inner(y) {
    return x + y;
  }
  return inner(10);
}
const result = outer(5);
    `);

    expect(trace.error).toBeNull();

    // Find step where inner is executing
    const duringInner = trace.steps.find((s) => s.contexts.some((c) => c.frame.name === "inner"));
    expect(duringInner).toBeDefined();

    // Inner context should have y, outer context should have x
    const innerCtx = duringInner!.contexts.find((c) => c.frame.name === "inner")!;
    const outerCtx = duringInner!.contexts.find((c) => c.frame.name === "outer")!;

    expect(innerCtx.scopes[0].bindings).toHaveProperty("y", 10);
    expect(outerCtx.scopes[0].bindings).toHaveProperty("x", 5);
  });

  test("trace steps can be indexed freely (step forward and backward)", () => {
    const trace = createTrace(`
const a = 1;
const b = 2;
const c = 3;
    `);

    expect(trace.error).toBeNull();
    expect(trace.steps).toHaveLength(3);

    // Step forward
    expect(globalBindings(trace.steps[0])).toHaveProperty("a", 1);
    expect(globalBindings(trace.steps[1])).toHaveProperty("b", 2);
    expect(globalBindings(trace.steps[2])).toHaveProperty("c", 3);

    // Step backward — just index in the other direction
    expect(globalBindings(trace.steps[1])).toHaveProperty("b", 2);
    expect(globalBindings(trace.steps[0])).toHaveProperty("a", 1);
  });

  test("preserves original source code", () => {
    const code = "const x = 42;";
    const trace = createTrace(code);
    expect(trace.code).toBe(code);
  });

  test("handles if/else statements", () => {
    const trace = createTrace(`
function abs(x) {
  if (x < 0) {
    return -x;
  } else {
    return x;
  }
}
const a = abs(-5);
const b = abs(3);
console.log(a);
console.log(b);
    `);

    expect(trace.error).toBeNull();
    const last = trace.steps[trace.steps.length - 1];
    expect(last.output).toEqual(["5", "3"]);
  });

  test("handles if without else", () => {
    const trace = createTrace(`
let x = 10;
if (x > 5) {
  x = 5;
}
console.log(x);
    `);

    expect(trace.error).toBeNull();
    const last = trace.steps[trace.steps.length - 1];
    expect(last.output).toEqual(["5"]);
  });

  test("handles default parameter values", () => {
    const trace = createTrace(`
function greet(name, greeting = "Hello") {
  return greeting + ", " + name;
}
const a = greet("Alice");
const b = greet("Bob", "Hi");
console.log(a);
console.log(b);
    `);

    expect(trace.error).toBeNull();
    const last = trace.steps[trace.steps.length - 1];
    expect(last.output).toEqual(["Hello, Alice", "Hi, Bob"]);
  });

  test("handles recursive functions", () => {
    const trace = createTrace(`
function factorial(n) {
  if (n <= 1) {
    return 1;
  }
  return n * factorial(n - 1);
}
const result = factorial(5);
console.log(result);
    `);

    expect(trace.error).toBeNull();
    const last = trace.steps[trace.steps.length - 1];
    expect(last.output).toEqual(["120"]);

    // Execution contexts should show recursive depth
    const deepest = trace.steps.reduce((max, s) =>
      s.contexts.length > max.contexts.length ? s : max,
    );
    // factorial(5) → factorial(4) → ... → factorial(1) = 5 + 1 global = 6
    expect(deepest.contexts.length).toBe(6);
    expect(deepest.contexts.every((c, i) => i === 0 || c.frame.name === "factorial")).toBe(true);
  });

  test("handles the full example with recursion and default params", () => {
    const trace = createTrace(`
function sumNumsBelow(n, sum = 0) {
  if (n === 0) {
    return sum;
  }
  return sumNumsBelow(n - 1, sum + n);
}
const result = sumNumsBelow(5);
console.log(result);
    `);

    expect(trace.error).toBeNull();
    const last = trace.steps[trace.steps.length - 1];
    expect(last.output).toEqual(["15"]);

    const deepest = trace.steps.reduce((max, s) =>
      s.contexts.length > max.contexts.length ? s : max,
    );
    // sumNumsBelow(5) → ... → sumNumsBelow(0) = 6 + 1 global = 7
    expect(deepest.contexts.length).toBe(7);
  });

  test("recursive frames only contain their own local bindings", () => {
    const trace = createTrace(`
function sumNumsBelow(n, sum = 0) {
  if (n === 0) {
    return sum;
  }
  return sumNumsBelow(n - 1, sum + n);
}
sumNumsBelow(3);
    `);

    expect(trace.error).toBeNull();

    // Find a step at recursion depth 3 (global + 3 sumNumsBelow frames)
    const atDepth3 = trace.steps.find((s) => s.contexts.length === 4);
    expect(atDepth3).toBeDefined();

    // The global context should have sumNumsBelow as a binding
    const globalCtx = atDepth3!.contexts[0];
    const globalKeys = Object.keys(globalCtx.scopes[0].bindings);
    expect(globalKeys).toContain("sumNumsBelow");

    // Each recursive frame should only have n and sum — NOT global bindings
    for (let i = 1; i < atDepth3!.contexts.length; i++) {
      const ctx = atDepth3!.contexts[i];
      const allKeys = ctx.scopes.flatMap((s) => Object.keys(s.bindings));
      expect(allKeys).toContain("n");
      expect(allKeys).toContain("sum");
      // Should NOT contain global-level bindings like sumNumsBelow
      expect(allKeys).not.toContain("sumNumsBelow");
    }
  });

  test("handles member expression updates (obj.prop++)", () => {
    const trace = createTrace(`
const obj = { count: 0 };
obj.count++;
obj.count++;
console.log(obj.count);
    `);

    expect(trace.error).toBeNull();
    const last = trace.steps[trace.steps.length - 1];
    expect(last.output).toEqual(["2"]);

    // obj is a heap ref — look up the actual data in the heap
    const afterFirst = trace.steps[1]; // after first obj.count++
    const ref = globalBindings(afterFirst).obj as { __heapRef: number };
    expect(ref.__heapRef).toBeDefined();
    const heapObj = afterFirst.heap[ref.__heapRef];
    expect(heapObj).toEqual({ type: "object", properties: { count: 1 } });

    const afterSecond = trace.steps[2]; // after second obj.count++
    const heapObj2 = afterSecond.heap[ref.__heapRef];
    expect(heapObj2).toEqual({ type: "object", properties: { count: 2 } });
  });

  test("same object has same heap ID across contexts", () => {
    const trace = createTrace(`
const myDog = { name: "Chico", age: 5 };
function pet(dog) {
  dog.age++;
}
pet(myDog);
    `);

    expect(trace.error).toBeNull();

    // Find a step inside pet() where both dog (local) and myDog (global) exist
    const insidePet = trace.steps.find((s) => s.contexts.some((c) => c.frame.name === "pet"));
    expect(insidePet).toBeDefined();

    // Both should reference the same heap ID
    const globalCtx = insidePet!.contexts[0];
    const petCtx = insidePet!.contexts.find((c) => c.frame.name === "pet")!;

    const myDogRef = globalCtx.scopes[0].bindings.myDog as { __heapRef: number };
    const dogRef = petCtx.scopes[0].bindings.dog as { __heapRef: number };

    expect(myDogRef.__heapRef).toBeDefined();
    expect(dogRef.__heapRef).toBeDefined();
    expect(myDogRef.__heapRef).toBe(dogRef.__heapRef);
  });

  test("objects are passed by reference (mutation example)", () => {
    const trace = createTrace(`
const myDog = { name: "Chico", age: 5 };
let myString = "original";

function update(dog, string) {
  dog.age++;
  string = "updated!";
}

update(myDog, myString);
console.log(myDog);
console.log(myString);
    `);

    expect(trace.error).toBeNull();
    const last = trace.steps[trace.steps.length - 1];
    // myDog.age was mutated (passed by reference)
    // myString was not (passed by value, reassignment is local)
    expect(last.output).toEqual(['{ name: "Chico", age: 6 }', "original"]);
  });
});
