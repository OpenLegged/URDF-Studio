import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

type ConversationMessageTone = 'user' | 'assistant'

interface ConversationMessageMarkdownProps {
  content: string
  tone: ConversationMessageTone
}

const toneClasses: Record<ConversationMessageTone, string> = {
  user: [
    'text-white',
    '[&_a]:text-white',
    '[&_a]:decoration-white/70',
    '[&_a:hover]:text-white',
    '[&_blockquote]:border-white/35',
    '[&_blockquote]:bg-white/10',
    '[&_code]:bg-white/15',
    '[&_hr]:border-white/20',
    '[&_pre]:border-white/20',
    '[&_pre]:bg-white/10',
    '[&_table]:border-white/20',
    '[&_td]:border-white/20',
    '[&_th]:border-white/20',
  ].join(' '),
  assistant: [
    'text-text-secondary',
    '[&_a]:text-system-blue',
    '[&_a]:decoration-system-blue/40',
    '[&_a:hover]:text-system-blue-hover',
    '[&_blockquote]:border-border-strong',
    '[&_blockquote]:bg-element-bg',
    '[&_code]:bg-element-bg',
    '[&_hr]:border-border-black',
    '[&_pre]:border-border-black',
    '[&_pre]:bg-element-bg',
    '[&_table]:border-border-black',
    '[&_td]:border-border-black',
    '[&_th]:border-border-black',
  ].join(' '),
}

export function ConversationMessageMarkdown({
  content,
  tone,
}: ConversationMessageMarkdownProps) {
  return (
    <div
      className={[
        'min-w-0 select-text break-words text-[11px] leading-relaxed',
        '[&_p:first-child]:mt-0',
        '[&_p:last-child]:mb-0',
        '[&_ul:last-child]:mb-0',
        '[&_ol:last-child]:mb-0',
        '[&_pre:last-child]:mb-0',
        '[&_blockquote:last-child]:mb-0',
        toneClasses[tone],
      ].join(' ')}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="mt-2 text-xs font-semibold first:mt-0">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-2 text-[11px] font-semibold first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-2 text-[11px] font-semibold first:mt-0">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="mt-2 text-[10px] font-semibold uppercase tracking-wide first:mt-0">{children}</h4>
          ),
          p: ({ children }) => (
            <p className="mt-2 whitespace-pre-wrap leading-relaxed first:mt-0">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="mt-2 list-disc space-y-1 pl-5 first:mt-0">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mt-2 list-decimal space-y-1 pl-5 first:mt-0">{children}</ol>
          ),
          li: ({ children }) => <li className="pl-1">{children}</li>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="font-medium underline underline-offset-2 transition-colors"
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="mt-2 rounded-lg border-l-2 px-2 py-1.5 italic first:mt-0">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-2 border-t" />,
          pre: ({ children }) => (
            <pre className="mt-2 overflow-x-auto rounded-lg border px-2 py-2 text-[11px] shadow-sm first:mt-0 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit">
              {children}
            </pre>
          ),
          code: ({ children }) => (
            <code className="rounded px-1 py-0.5 font-mono text-[10px] leading-relaxed">
              {children}
            </code>
          ),
          table: ({ children }) => (
            <div className="mt-2 overflow-x-auto first:mt-0">
              <table className="min-w-full border-collapse rounded-lg border text-[11px]">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-black/5 dark:bg-white/5">{children}</thead>,
          th: ({ children }) => (
            <th className="border px-2 py-1.5 text-left font-semibold">{children}</th>
          ),
          td: ({ children }) => <td className="border px-2 py-1.5 align-top">{children}</td>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

export default ConversationMessageMarkdown
