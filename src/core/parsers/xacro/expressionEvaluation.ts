import { parseExpression, type Expression } from './expressionSyntax';

export interface ExpressionContext {
  resolve: (name: string) => unknown;
  loadYaml: (path: string) => unknown;
  arg: (name: string) => string | undefined;
}

const CONSTANTS: Record<string, unknown> = {
  True: true, False: false, None: null, true: true, false: false, null: null, pi: Math.PI,
};
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Expected a finite number');
  return value;
}

function property(target: unknown, key: unknown): unknown {
  if (typeof key !== 'string' && typeof key !== 'number') throw new Error('Invalid data key');
  if (FORBIDDEN_KEYS.has(String(key))) throw new Error(`Forbidden data key: ${key}`);
  if (Array.isArray(target) || typeof target === 'string') {
    const index = typeof key === 'number' ? key : Number.NaN;
    if (!Number.isInteger(index)) throw new Error('Expected an integer index');
    const normalized = index < 0 ? target.length + index : index;
    if (normalized < 0 || normalized >= target.length) throw new Error(`Index out of range: ${index}`);
    return target[normalized];
  }
  if (target && typeof target === 'object' && Object.hasOwn(target, key)) {
    return Reflect.get(target, key);
  }
  throw new Error(`Missing data key: ${key}`);
}

function truthy(value: unknown): boolean {
  if (Array.isArray(value) || typeof value === 'string') return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return Boolean(value);
}

function binary(op: string, a: unknown, b: unknown): unknown {
  if (op === '==') return a === b;
  if (op === '!=') return a !== b;
  if (op === '+' && typeof a === 'string' && typeof b === 'string') return a + b;
  const left = number(a);
  const right = number(b);
  switch (op) {
    case '+': return left + right;
    case '-': return left - right;
    case '*': return left * right;
    case '/': return number(left / right);
    case '%': return number(((left % right) + right) % right);
    case '**': return number(left ** right);
    case '<': return left < right;
    case '>': return left > right;
    case '<=': return left <= right;
    case '>=': return left >= right;
    default: throw new Error(`Unsupported operator ${op}`);
  }
}

function symbolPath(node: Expression): string | undefined {
  if (node.kind === 'name') return node.name;
  if (node.kind === 'member') {
    const parent = symbolPath(node.target);
    return parent ? `${parent}.${node.name}` : undefined;
  }
  return undefined;
}

function resolveName(name: string, context: ExpressionContext, locals: ReadonlyMap<string, unknown>): unknown {
  if (locals.has(name)) return locals.get(name);
  if (Object.hasOwn(CONSTANTS, name)) return CONSTANTS[name];
  const value = context.resolve(name);
  if (value === undefined) throw new Error(`Unknown Xacro property: ${name}`);
  return value;
}

function unary(op: string, value: unknown): unknown {
  if (op === 'not') return !truthy(value);
  return op === '-' ? -number(value) : number(value);
}

const BUILTINS = new Set(['xacro.load_yaml', 'load_yaml', 'xacro.arg', 'arg', 'str', 'float', 'int']);
function callBuiltin(name: string, args: unknown[], context: ExpressionContext): unknown {
  if (args.length !== 1) throw new Error(`${name} requires one argument`);
  const value = args[0];
  if (name === 'str') {
    if (!['string', 'number', 'boolean'].includes(typeof value)) throw new Error('str requires a scalar');
    return typeof value === 'boolean' ? (value ? 'True' : 'False') : String(value);
  }
  if (name === 'float' || name === 'int') {
    if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Expected a numeric scalar');
    const numeric = number(Number(value));
    return name === 'int' ? Math.trunc(numeric) : numeric;
  }
  if (typeof value !== 'string') throw new Error(`${name} requires a string`);
  return name.endsWith('load_yaml') ? context.loadYaml(value) : context.arg(value);
}

function callMethod(name: string, receiver: unknown, args: unknown[]): unknown {
  if (name === 'get' && receiver && typeof receiver === 'object' && !Array.isArray(receiver)) {
    if (args.length < 1 || args.length > 2 || typeof args[0] !== 'string') throw new Error('Invalid dictionary.get arguments');
    if (FORBIDDEN_KEYS.has(args[0])) throw new Error(`Forbidden data key: ${args[0]}`);
    return Object.hasOwn(receiver, args[0]) ? property(receiver, args[0]) : (args[1] ?? null);
  }
  if (name === 'join' && typeof receiver === 'string') {
    if (args.length !== 1 || !Array.isArray(args[0]) || !args[0].every(item => typeof item === 'string')) {
      throw new Error('str.join requires a list of strings');
    }
    return args[0].join(receiver);
  }
  throw new Error(`Unsupported Xacro method: ${name}`);
}

function comprehensionItems(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 4096) throw new Error('Expected a list of at most 4096 items');
  return value;
}

/** Interpret data, never execute source as JavaScript or expose host objects/functions. */
export function evaluateDataExpression(source: string, context: ExpressionContext): unknown {
  let steps = 0;
  const evaluate = (node: Expression, locals: ReadonlyMap<string, unknown>): unknown => {
    if (++steps > 20000) throw new Error('Xacro expression evaluation budget exceeded');
    switch (node.kind) {
      case 'literal': return node.value;
      case 'name': return resolveName(node.name, context, locals);
      case 'array': return node.items.map(item => evaluate(item, locals));
      case 'unary': return unary(node.op, evaluate(node.value, locals));
      case 'binary': {
        const left = evaluate(node.left, locals);
        if (node.op === 'and') return truthy(left) ? evaluate(node.right, locals) : left;
        if (node.op === 'or') return truthy(left) ? left : evaluate(node.right, locals);
        return binary(node.op, left, evaluate(node.right, locals));
      }
      case 'conditional': return evaluate(truthy(evaluate(node.condition, locals)) ? node.yes : node.no, locals);
      case 'index': return property(evaluate(node.target, locals), evaluate(node.key, locals));
      case 'member': {
        const name = symbolPath(node);
        const resolved = name ? context.resolve(name) : undefined;
        return resolved === undefined ? property(evaluate(node.target, locals), node.name) : resolved;
      }
      case 'comprehension': {
        const items = comprehensionItems(evaluate(node.source, locals));
        return items.map(item => evaluate(node.value, new Map([...locals, [node.name, item]])));
      }
      case 'call': return call(node, locals);
    }
  };

  const call = (node: Extract<Expression, { kind: 'call' }>, locals: ReadonlyMap<string, unknown>): unknown => {
    const name = symbolPath(node.target);
    const args = node.args.map(arg => evaluate(arg, locals));
    if (name && BUILTINS.has(name)) return callBuiltin(name, args, context);
    if (node.target.kind === 'member') {
      return callMethod(node.target.name, evaluate(node.target.target, locals), args);
    }
    throw new Error(`Unsupported Xacro function: ${name ?? 'expression'}`);
  };
  return evaluate(parseExpression(source), new Map());
}
