import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTool, evaluateExpression } from '../src/tools/calculator.ts';
import { createToolRegistry } from '../src/tools/registry.ts';

test('respects operator precedence, parentheses and associativity', () => {
  assert.equal(evaluateExpression('2 + 3 * 4'), 14);
  assert.equal(evaluateExpression('(2 + 3) * 4'), 20);
  assert.equal(evaluateExpression('-2 ^ 2'), -4);
  assert.equal(evaluateExpression('2 ^ 3 ^ 2'), 512);
  assert.equal(evaluateExpression('10 % 4'), 2);
  assert.equal(evaluateExpression(' 1.5 * (2 + 2) '), 6);
});

test('rejects unsafe or invalid expressions', () => {
  assert.throws(() => evaluateExpression(''), /empty/);
  assert.throws(() => evaluateExpression('2 / 0'), /Division by zero/);
  assert.throws(() => evaluateExpression('2 % 0'), /Division by zero/);
  assert.throws(() => evaluateExpression('2 +'), /Unexpected end/);
  assert.throws(() => evaluateExpression('(2 + 3'), /Missing closing/);
  assert.throws(() => evaluateExpression('alert(1)'), /Unexpected character/);
  assert.throws(() => evaluateExpression('2 ^ 101'), /Exponent is too large/);
  assert.throws(() => evaluateExpression('1.2.3'), /Invalid number/);
});

test('tool registry executes tools and converts failures into results', async () => {
  const registry = createToolRegistry([calculateTool]);

  const success = await registry.run('calculate', { expression: '(2 + 3) * 4' });
  assert.deepEqual(success, {
    ok: true,
    data: { expression: '(2 + 3) * 4', result: 20 },
  });

  const failure = await registry.run('calculate', { expression: '2 + two' });
  assert.equal(failure.ok, false);
  assert.match(failure.error ?? '', /Unexpected character/);

  const missing = await registry.run('nope', {});
  assert.equal(missing.ok, false);
  assert.match(missing.error ?? '', /Unknown tool/);
});
