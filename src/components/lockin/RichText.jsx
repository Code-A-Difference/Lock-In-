import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import 'katex/contrib/mhchem';          // \ce{H2O} and \pu{} for chemistry
import { cn } from '@/lib/utils';
import { normaliseMath } from '@/lib/mathText';

/**
 * Markdown with real maths and chemistry. The AI writes LaTeX — "$\frac{1}{2}$",
 * "\(x^2\)", "\ce{2H2 + O2 -> 2H2O}" — which used to show up as dollar signs
 * and backslashes. KaTeX turns it into proper notation.
 */
const plugins = { remarkPlugins: [remarkMath], rehypePlugins: [[rehypeKatex, { throwOnError: false, strict: 'ignore' }]] };
const inline = { p: ({ children }) => <>{children}</> };

/** One line of text (a quiz option, a note point) with any maths in it rendered. */
export function MathLine({ text }) {
  const t = String(text ?? '');
  if (!/[$\\]/.test(t)) return t;          // nothing to render: keep it a plain string
  return <ReactMarkdown {...plugins} components={inline}>{normaliseMath(t)}</ReactMarkdown>;
}

export default function RichText({ text, className }) {
  return (
    <div className={cn('prose prose-sm max-w-none dark:prose-invert prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-headings:my-2 prose-pre:text-xs [&_ol]:list-decimal [&_ul]:list-disc [&_ol]:pl-5 [&_ul]:pl-5 [&_.katex-display]:my-2 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden', className)}>
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: 'ignore' }]]}>
        {normaliseMath(text)}
      </ReactMarkdown>
    </div>
  );
}
