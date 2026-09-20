/** Syntax for the data-only Python expression subset accepted by browser Xacro. */
export type Expression =
  | { kind: 'literal'; value: unknown }
  | { kind: 'name'; name: string }
  | { kind: 'array'; items: Expression[] }
  | { kind: 'unary'; op: string; value: Expression }
  | { kind: 'binary'; op: string; left: Expression; right: Expression }
  | { kind: 'conditional'; condition: Expression; yes: Expression; no: Expression }
  | { kind: 'index'; target: Expression; key: Expression }
  | { kind: 'member'; target: Expression; name: string }
  | { kind: 'call'; target: Expression; args: Expression[] }
  | { kind: 'comprehension'; value: Expression; name: string; source: Expression };

interface Token { text: string; literal?: string | number }
const PRECEDENCE: Record<string, number> = {
  or: 1, and: 2, '==': 3, '!=': 3, '<': 3, '>': 3, '<=': 3, '>=': 3,
  '+': 4, '-': 4, '*': 5, '/': 5, '%': 5, '**': 7,
};

function tokenize(source: string): Token[] {
  if (source.length > 16384) throw new Error('Xacro expression is too long');
  const tokens: Token[] = [];
  const pattern = /\s+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_]\w*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\*\*|==|!=|<=|>=|[+\-*/%<>()\[\],.]/gy;
  let offset = 0;
  while (offset < source.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(source);
    if (!match) throw new Error(`Unsupported Xacro expression at ${source.slice(offset, offset + 30)}`);
    offset = pattern.lastIndex;
    const text = match[0];
    if (/^\s/.test(text)) continue;
    if (/^['"]/.test(text)) {
      const literal = text.slice(1, -1).replace(/\\([\\'"nrt])/g, (_, char: string) =>
        ({ n: '\n', r: '\r', t: '\t' })[char] ?? char);
      tokens.push({ text, literal });
    } else if (/^(?:\d|\.\d)/.test(text)) {
      tokens.push({ text, literal: Number(text) });
    } else {
      tokens.push({ text });
    }
  }
  if (tokens.length > 2048) throw new Error('Xacro expression has too many tokens');
  return tokens;
}

export function parseExpression(source: string): Expression {
  const tokens = tokenize(source);
  let position = 0;
  let depth = 0;
  const peek = () => tokens[position]?.text;
  const accept = (text: string) => {
    if (peek() !== text) return false;
    position++;
    return true;
  };
  const expect = (text: string) => {
    if (!accept(text)) throw new Error(`Expected "${text}" in Xacro expression`);
  };

  function sequence(end: string): Expression[] {
    const items: Expression[] = [];
    if (accept(end)) return items;
    do {
      items.push(expression());
      if (accept(end)) return items;
      expect(',');
    } while (!accept(end));
    return items;
  }

  function atom(): Expression {
    const token = tokens[position++];
    if (!token) throw new Error('Incomplete Xacro expression');
    if (token.literal !== undefined) return { kind: 'literal', value: token.literal };
    if (token.text === '(') {
      const value = expression();
      expect(')');
      return value;
    }
    if (token.text === '[') {
      if (accept(']')) return { kind: 'array', items: [] };
      const value = expression();
      if (accept('for')) {
        const name = tokens[position++]?.text;
        if (!name || !/^[A-Za-z_]\w*$/.test(name)) throw new Error('Invalid comprehension variable');
        expect('in');
        const source = expression();
        expect(']');
        return { kind: 'comprehension', value, name, source };
      }
      const items = [value];
      while (accept(',')) {
        if (peek() === ']') break;
        items.push(expression());
      }
      expect(']');
      return { kind: 'array', items };
    }
    if (/^[A-Za-z_]\w*$/.test(token.text)) return { kind: 'name', name: token.text };
    throw new Error(`Unexpected "${token.text}" in Xacro expression`);
  }

  function postfix(): Expression {
    let value = atom();
    while (true) {
      if (accept('[')) {
        value = { kind: 'index', target: value, key: expression() };
        expect(']');
      } else if (accept('.')) {
        const name = tokens[position++]?.text;
        if (!name || !/^[A-Za-z_]\w*$/.test(name)) throw new Error('Invalid member name');
        value = { kind: 'member', target: value, name };
      } else if (accept('(')) {
        value = { kind: 'call', target: value, args: sequence(')') };
      } else return value;
    }
  }

  function expression(min = 0): Expression {
    if (++depth > 64) throw new Error('Xacro expression nesting exceeds 64');
    let left: Expression;
    if (['+', '-', 'not'].includes(peek() ?? '')) {
      const op = tokens[position++].text;
      left = { kind: 'unary', op, value: expression(op === 'not' ? 3 : 6) };
    } else left = postfix();
    while (Object.hasOwn(PRECEDENCE, peek() ?? '') && PRECEDENCE[peek()!] >= min) {
      const op = tokens[position++].text;
      const right = expression(PRECEDENCE[op] + (op === '**' ? 0 : 1));
      left = { kind: 'binary', op, left, right };
    }
    if (min === 0 && accept('if')) {
      const condition = expression(1);
      expect('else');
      left = { kind: 'conditional', condition, yes: left, no: expression() };
    }
    depth--;
    return left;
  }

  const result = expression();
  if (position !== tokens.length) throw new Error(`Unsupported Xacro expression near ${peek()}`);
  return result;
}
