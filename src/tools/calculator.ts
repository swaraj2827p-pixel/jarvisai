import { z } from 'zod';
import type { Tool } from './registry.ts';

const MAX_EXPRESSION_LENGTH = 200;
const MAX_EXPONENT = 100;

type Operator = '+' | '-' | '*' | '/' | '%' | '^';

type Token =
  | { kind: 'number'; value: number }
  | { kind: 'operator'; value: Operator }
  | { kind: 'paren'; value: '(' | ')' };

const OPERATORS: readonly string[] = ['+', '-', '*', '/', '%', '^'];

export function evaluateExpression(input: string): number {
  const expression = input.trim();
  if (expression.length === 0) throw new Error('Expression is empty.');
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    throw new Error(`Expression is too long (max ${MAX_EXPRESSION_LENGTH} characters).`);
  }

  const tokens = tokenize(expression);
  let position = 0;

  function peek(): Token | undefined {
    return tokens[position];
  }

  function consume(): Token | undefined {
    const token = tokens[position];
    position += 1;
    return token;
  }

  function parseExpression(): number {
    let value = parseTerm();
    for (;;) {
      const token = peek();
      if (!token || token.kind !== 'operator' || (token.value !== '+' && token.value !== '-')) break;
      consume();
      const right = parseTerm();
      value = token.value === '+' ? value + right : value - right;
    }
    return value;
  }

  function parseTerm(): number {
    let value = parseUnary();
    for (;;) {
      const token = peek();
      if (
        !token ||
        token.kind !== 'operator' ||
        (token.value !== '*' && token.value !== '/' && token.value !== '%')
      ) {
        break;
      }
      consume();
      const right = parseUnary();
      if ((token.value === '/' || token.value === '%') && right === 0) {
        throw new Error('Division by zero.');
      }
      if (token.value === '*') value *= right;
      else if (token.value === '/') value /= right;
      else value %= right;
    }
    return value;
  }

  function parseUnary(): number {
    const token = peek();
    if (token && token.kind === 'operator' && (token.value === '+' || token.value === '-')) {
      consume();
      const value = parseUnary();
      return token.value === '-' ? -value : value;
    }
    return parsePower();
  }

  function parsePower(): number {
    const base = parsePrimary();
    const token = peek();
    if (token && token.kind === 'operator' && token.value === '^') {
      consume();
      const exponent = parseUnary();
      if (Math.abs(exponent) > MAX_EXPONENT) {
        throw new Error(`Exponent is too large (max ${MAX_EXPONENT}).`);
      }
      return base ** exponent;
    }
    return base;
  }

  function parsePrimary(): number {
    const token = consume();
    if (!token) throw new Error('Unexpected end of expression.');
    if (token.kind === 'number') return token.value;
    if (token.kind === 'paren' && token.value === '(') {
      const value = parseExpression();
      const closing = consume();
      if (!closing || closing.kind !== 'paren' || closing.value !== ')') {
        throw new Error('Missing closing parenthesis.');
      }
      return value;
    }
    throw new Error(`Unexpected token "${token.value}".`);
  }

  const result = parseExpression();
  if (position !== tokens.length) {
    const extra = tokens[position];
    throw new Error(`Unexpected token "${extra ? extra.value : '?'}".`);
  }
  if (!Number.isFinite(result)) throw new Error('Result is not a finite number.');
  return result;
}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < expression.length) {
    const character = expression.charAt(index);

    if (
      character === ' ' ||
      character === '\t' ||
      character === '\n' ||
      character === '\r'
    ) {
      index += 1;
      continue;
    }

    if (isDigit(character) || character === '.') {
      let end = index;
      while (
        end < expression.length &&
        (isDigit(expression.charAt(end)) || expression.charAt(end) === '.')
      ) {
        end += 1;
      }
      const raw = expression.slice(index, end);
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error(`Invalid number "${raw}".`);
      tokens.push({ kind: 'number', value });
      index = end;
      continue;
    }

    if (OPERATORS.includes(character)) {
      tokens.push({ kind: 'operator', value: character as Operator });
      index += 1;
      continue;
    }

    if (character === '(' || character === ')') {
      tokens.push({ kind: 'paren', value: character });
      index += 1;
      continue;
    }

    throw new Error(`Unexpected character "${character}".`);
  }

  return tokens;
}

function isDigit(character: string): boolean {
  return character >= '0' && character <= '9';
}

const argumentsSchema = z
  .object({
    expression: z.string().trim().min(1).max(MAX_EXPRESSION_LENGTH),
  })
  .strict();

export const calculateTool: Tool = {
  name: 'calculate',
  description:
    'Safely evaluate an arithmetic expression using +, -, *, /, %, ^ and parentheses. Use this instead of doing arithmetic in your head.',
  parameters: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'Arithmetic expression, for example "(12 + 8) * 3".',
      },
    },
    required: ['expression'],
    additionalProperties: false,
  },
  async run(rawArguments) {
    const { expression } = argumentsSchema.parse(rawArguments);
    const result = evaluateExpression(expression);
    return { expression, result };
  },
};
