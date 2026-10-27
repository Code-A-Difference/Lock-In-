/**
 * Maths in the assistant's text: getting it ready to render, and reading it
 * aloud. Pure, so tests/mathText.test.mjs runs it in Node.
 */

/**
 * Pair up the dollar signs in a reply so the maths renders and the prose doesn't.
 * Models get these wrong in a few predictable ways: a stray $ inside a $$…$$
 * formula, $$$ where $$ was meant, or a $ with nothing to pair with, which turns
 * everything after it into maths. A stray $ inside a formula is dropped, $$$ is
 * read as $$, and a $ that can't pair is escaped so it shows as a dollar sign.
 * Code (fenced or in backticks) and \$ are left alone, and a $$ block on lines of
 * its own runs until its closing $$.
 */
export function repairDollars(text) {
  let inFence = false;
  let inBlock = false;
  return String(text || '').split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return line; }
    if (inFence) return line;
    const bare = line.trim();
    if (inBlock) {
      if (bare.includes('$$')) inBlock = false;
      return line;
    }
    if (bare === '$$') { inBlock = true; return line; }
    return repairDollarLine(line);
  }).join('\n');
}

/** One line: pair its dollar runs left to right, then write the line back with the repairs. */
function repairDollarLine(line) {
  const runs = [];
  let inCode = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '`') inCode = !inCode;
    else if (inCode) continue;
    else if (c === '\\') i++;                        // \$ and \\ are not delimiters
    else if (c === '$') {
      let j = i;
      while (line[j] === '$') j++;
      runs.push({ start: i, end: j, display: j - i > 1, action: '' });
      i = j - 1;
    }
  }
  let open = null;
  for (const run of runs) {
    if (!open) open = run;
    else if (open.display) {
      if (run.display) { open.action = run.action = 'keep'; open = null; }
      else run.action = 'drop';                      // a lone $ inside a formula
    } else if (run.display) {
      open.action = 'literal';                       // the lone $ never closed
      open = run;
    } else {
      open.action = run.action = 'keep';
      open = null;
    }
  }
  if (open) open.action = 'literal';
  let out = '';
  let last = 0;
  for (const run of runs) {
    out += line.slice(last, run.start);
    if (run.action === 'literal') out += '\\$'.repeat(run.end - run.start);
    else if (run.action === 'keep') out += run.display ? '$$' : '$';
    last = run.end;
  }
  return out + line.slice(last);
}

/**
 * Models write maths several ways. KaTeX (through remark-math) understands
 * $…$ and $$…$$, so the other delimiters are rewritten to those, and a bare
 * \ce{…} or \frac{…}{…} outside any delimiters gets wrapped.
 */
export function normaliseMath(text) {
  let t = repairDollars(text);
  t = t.replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `\n$$${m.trim()}$$\n`);
  t = t.replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$${m.trim()}$`);
  // a lone \ce{...} or \frac... that isn't already inside $…$
  const parts = t.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+\$|`[^`]*`)/g);
  return parts.map((p, i) => (i % 2 ? p : p.replace(/\\(ce|pu)\{((?:[^{}]|\{[^{}]*\})*)\}/g, (m) => `$${m}$`)
    .replace(/(^|[\s(])(\\(?:frac|dfrac|sqrt|int|sum|lim)\b(?:\{(?:[^{}]|\{[^{}]*\})*\}|[^\s,.;)]*)+)/g, (_, pre, m) => `${pre}$${m}$`))).join('');
}

/* LaTeX commands a model might write inside a JSON string. */
const LATEX_CMDS = new Set(`frac dfrac tfrac sqrt times div cdot cdotp pm mp text textbf textit mathrm mathbf mathit mathbb mathcal operatorname
theta Theta vartheta tau tan tanh beta bar boxed binom rightarrow Rightarrow rightleftharpoons right rho neq ne nu nabla not vec
varepsilon varphi alpha gamma Gamma delta Delta epsilon lambda Lambda mu pi Pi sigma Sigma phi Phi omega Omega eta kappa xi psi chi
zeta iota int iint oint sum prod lim infty partial le leq ge geq approx equiv propto sim sin cos sec csc cot arcsin arccos
arctan sinh cosh log ln exp left ce pu circ degree angle perp parallel in notin cup cap to dots ldots cdots vdots overline underline
hat dot ddot quad qquad displaystyle pmatrix bmatrix begin end hbar ell langle rangle leftarrow longrightarrow leftrightarrow
Leftrightarrow uparrow downarrow forall exists subset subseteq emptyset therefore because prime mid nmid gcd max min det overrightarrow
underbrace overbrace stackrel xrightarrow cancel square triangle`.split(/\s+/));

/**
 * A model asked for JSON often writes LaTeX with one backslash ("\frac"),
 * which JSON reads as an escape: \f becomes a form feed, \t a tab, \b a
 * backspace, \n a newline, and \s, \c… make JSON.parse fail outright. Double
 * the backslash in front of known LaTeX commands before parsing; real escapes
 * ("\n" before a word, "\"") and already-doubled ones are left alone.
 */
export function escapeLatexInJson(raw) {
  return String(raw || '').replace(/\\\\|\\u[0-9a-fA-F]{4}|\\([a-zA-Z]+)|\\([^"\\/])/g, (m, name, other) => {
    if (name) {
      // a known command, or any letter run JSON couldn't read anyway (\sqrt, \qty…)
      return LATEX_CMDS.has(name) || !'bfnrt'.includes(name[0]) ? `\\\\${name}` : m;
    }
    if (other) return `\\\\${other}`;     // \, \; \! \{ \% …, spacing and symbols, never valid JSON
    return m;                              // \\ \uXXXX \" \/ stay as they are
  });
}

const GREEK = {
  alpha: 'alpha', beta: 'beta', gamma: 'gamma', delta: 'delta', Delta: 'delta', epsilon: 'epsilon', varepsilon: 'epsilon',
  theta: 'theta', lambda: 'lambda', mu: 'mu', pi: 'pi', rho: 'rho', sigma: 'sigma', Sigma: 'sigma', tau: 'tau',
  phi: 'phi', varphi: 'phi', omega: 'omega', Omega: 'omega', eta: 'eta', kappa: 'kappa', nu: 'nu', xi: 'xi', psi: 'psi', chi: 'chi',
};
const WORDS = {
  times: ' times ', cdot: ' times ', div: ' divided by ', pm: ' plus or minus ', mp: ' minus or plus ',
  le: ' is less than or equal to ', leq: ' is less than or equal to ', ge: ' is greater than or equal to ', geq: ' is greater than or equal to ',
  neq: ' is not equal to ', ne: ' is not equal to ', approx: ' is approximately ', equiv: ' is equivalent to ', propto: ' is proportional to ',
  infty: ' infinity ', int: ' the integral of ', iint: ' the double integral of ', sum: ' the sum of ', prod: ' the product of ',
  partial: ' partial ', nabla: ' del ', to: ' to ', rightarrow: ' gives ', longrightarrow: ' gives ', Rightarrow: ' implies ',
  leftrightarrow: ' is in equilibrium with ', rightleftharpoons: ' is in equilibrium with ', degree: ' degrees ', circ: ' degrees ',
  in: ' in ', cup: ' union ', cap: ' intersect ', angle: ' angle ', perp: ' is perpendicular to ', parallel: ' is parallel to ',
  sin: ' sine ', cos: ' cosine ', tan: ' tangent ', log: ' log ', ln: ' natural log ', lim: ' the limit ', ldots: ' and so on ', dots: ' and so on ', cdots: ' and so on ',
};

/** Read one brace group starting at s[i] === '{'; returns [content, nextIndex]. */
function group(s, i) {
  if (s[i] !== '{') {
    const m = /^\\[a-zA-Z]+|^./.exec(s.slice(i));
    return [m ? m[0] : '', i + (m ? m[0].length : 0)];
  }
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '{') depth++;
    else if (s[j] === '}' && --depth === 0) return [s.slice(i + 1, j), j + 1];
  }
  return [s.slice(i + 1), s.length];
}

/** LaTeX (maths or \ce chemistry) -> words a voice can say. */
export function latexToSpeech(src) {
  const s = String(src || '');
  let out = '';
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === '\\') {
      const m = /^\\([a-zA-Z]+)/.exec(s.slice(i));
      if (!m) { i += 2; out += ' '; continue; }
      const cmd = m[1];
      i += m[0].length;
      while (s[i] === ' ') i++;
      if (cmd === 'frac' || cmd === 'dfrac' || cmd === 'tfrac') {
        const [a, j] = group(s, i); const [b, k] = group(s, j); i = k;
        out += ` ${latexToSpeech(a)} over ${latexToSpeech(b)} `;
      } else if (cmd === 'sqrt') {
        let n = '';
        if (s[i] === '[') { const e = s.indexOf(']', i); n = s.slice(i + 1, e); i = e + 1; }
        const [a, j] = group(s, i); i = j;
        out += n === '3' ? ` the cube root of ${latexToSpeech(a)} ` : n ? ` the ${latexToSpeech(n)}th root of ${latexToSpeech(a)} ` : ` the square root of ${latexToSpeech(a)} `;
      } else if (cmd === 'ce' || cmd === 'pu' || cmd === 'text' || cmd === 'mathrm' || cmd === 'mathbf' || cmd === 'operatorname' || cmd === 'textbf' || cmd === 'mathit' || cmd === 'vec' || cmd === 'hat' || cmd === 'bar' || cmd === 'overline') {
        const [a, j] = group(s, i); i = j;
        out += cmd === 'ce' ? ` ${chemToSpeech(a)} ` : cmd === 'vec' ? ` vector ${latexToSpeech(a)} ` : cmd === 'bar' || cmd === 'overline' ? ` ${latexToSpeech(a)} bar ` : ` ${latexToSpeech(a)} `;
      } else if (cmd === 'left' || cmd === 'right' || cmd === 'displaystyle' || cmd === 'quad' || cmd === 'qquad' || cmd === 'limits') {
        out += ' ';
      } else if (GREEK[cmd]) {
        out += ` ${GREEK[cmd]} `;
      } else if (WORDS[cmd]) {
        out += WORDS[cmd];
      } else {
        out += ` ${cmd} `;
      }
    } else if (c === '^') {
      const [a, j] = group(s, i + 1); i = j;
      const e = a.trim();
      out += e === '2' ? ' squared ' : e === '3' ? ' cubed ' : e === '\\circ' ? ' degrees ' : e === '-1' ? ' inverse ' : ` to the power of ${latexToSpeech(e)} `;
    } else if (c === '_') {
      const [a, j] = group(s, i + 1); i = j;
      out += ` sub ${latexToSpeech(a)} `;
    } else if (c === '{' || c === '}' || c === '$' || c === '&') {
      out += ' '; i++;
    } else if (c === '=') { out += ' equals '; i++; }
    else if (c === '+') { out += ' plus '; i++; }
    else if (c === '-' && /[\w)}\s]/.test(s[i - 1] || '') && s[i + 1] !== '>') { out += ' minus '; i++; }
    else if (c === '-') { out += ' negative '; i++; }
    else if (c === '<') { out += ' is less than '; i++; }
    else if (c === '>') { out += ' is greater than '; i++; }
    else if (c === '/') { out += ' over '; i++; }
    else { out += c; i++; }
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** "2H2 + O2 -> 2H2O" -> "2 H 2 plus O 2 yields 2 H 2 O" (said as letters and numbers, which is how teachers read it). */
export function chemToSpeech(src) {
  return String(src || '')
    .replace(/<=>|<->/g, ' is in equilibrium with ')
    .replace(/->/g, ' yields ')
    .replace(/\^\{?([0-9]*)([+-])\}?/g, (_, n, sign) => ` ${n || ''} ${sign === '+' ? 'plus' : 'minus'} charge `)
    .replace(/\(([a-z]{1,3})\)/g, (_, st) => ` ${({ s: 'solid', l: 'liquid', g: 'gas', aq: 'aqueous' })[st] || st} `)
    .replace(/\+/g, ' plus ')
    .replace(/([A-Z][a-z]?)(\d+)/g, '$1 $2 ')
    .replace(/(\d)([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Turn every $…$ / $$…$$ / \(…\) / \[…\] in a reply into speech. */
export function speakMath(text) {
  return normaliseMath(text)
    .replace(/(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$/g, (_, m) => ` ${latexToSpeech(m)}. `)
    .replace(/(?<!\\)\$([^$\n]+)\$/g, (_, m) => ` ${latexToSpeech(m)} `)
    .replace(/\\\$/g, '$');                       // dollars that didn't pair are spoken as dollars
}

/** Unicode symbols typed with the symbol pad, read aloud. */
export const SYMBOL_WORDS = {
  '√': ' square root of ', '∛': ' cube root of ', 'π': ' pi ', 'θ': ' theta ', '∞': ' infinity ', '≤': ' less than or equal to ', '≥': ' greater than or equal to ',
  '≠': ' not equal to ', '≈': ' approximately ', '±': ' plus or minus ', '×': ' times ', '÷': ' divided by ', '°': ' degrees ', '∫': ' integral of ', 'Σ': ' sum of ',
  '→': ' yields ', '⇌': ' is in equilibrium with ', 'Δ': ' delta ', 'λ': ' lambda ', 'μ': ' mu ', 'α': ' alpha ', 'β': ' beta ', 'γ': ' gamma ', 'ω': ' omega ', 'Ω': ' ohms ',
  '²': ' squared ', '³': ' cubed ', '½': ' one half ', '∠': ' angle ', '⊥': ' perpendicular to ', '∥': ' parallel to ', '∂': ' partial ',
};
