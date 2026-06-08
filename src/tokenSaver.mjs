const TOOL_LIKE_ROLES = new Set(['tool', 'function']);

export function applyTokenSaver(body, options = {}) {
  if (!options.enabled || !body || typeof body !== 'object') return body;

  const cloned = structuredCloneSafe(body);
  if (!Array.isArray(cloned.messages)) return cloned;

  const maxToolChars = Number(options.maxToolChars || 12000);
  const maxContentChars = Number(options.maxContentChars || 30000);

  cloned.messages = cloned.messages.map((message) => {
    if (!message || typeof message !== 'object') return message;
    const role = message.role;

    if (typeof message.content === 'string') {
      const max = TOOL_LIKE_ROLES.has(role) ? maxToolChars : maxContentChars;
      return { ...message, content: trimText(message.content, max, role) };
    }

    if (Array.isArray(message.content)) {
      return {
        ...message,
        content: message.content.map((part) => {
          if (part?.type === 'text' && typeof part.text === 'string') {
            const max = TOOL_LIKE_ROLES.has(role) ? maxToolChars : maxContentChars;
            return { ...part, text: trimText(part.text, max, role) };
          }
          return part;
        })
      };
    }

    return message;
  });

  return cloned;
}

function trimText(text, maxChars, role) {
  if (!Number.isFinite(maxChars) || maxChars <= 0) return text;
  if (text.length <= maxChars) return text;

  const headSize = Math.floor(maxChars * 0.65);
  const tailSize = maxChars - headSize;
  const omitted = text.length - maxChars;
  return [
    text.slice(0, headSize),
    `\n\n[hermes-router token-saver: trimmed ${omitted} chars from role=${role}]\n\n`,
    text.slice(-tailSize)
  ].join('');
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
