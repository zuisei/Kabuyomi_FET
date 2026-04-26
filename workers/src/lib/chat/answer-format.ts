const LONG_ANSWER_THRESHOLD = 180;
const TARGET_PARAGRAPH_CHARS = 170;
const MAX_SENTENCES_PER_PARAGRAPH = 2;

export function formatChatAnswerForDisplay(answer: string): string {
  const trimmed = answer.trim();
  if (trimmed.length < LONG_ANSWER_THRESHOLD || trimmed.includes("\n")) {
    return trimmed;
  }

  const sentences = splitJapaneseSentences(trimmed);
  if (sentences.length < 3) {
    return trimmed;
  }

  const paragraphs: string[] = [];
  let current: string[] = [];
  let currentLength = 0;

  for (const sentence of sentences) {
    const nextLength = currentLength + sentence.length;
    const shouldBreak =
      current.length > 0 &&
      (current.length >= MAX_SENTENCES_PER_PARAGRAPH || nextLength >= TARGET_PARAGRAPH_CHARS);

    if (shouldBreak) {
      paragraphs.push(current.join(""));
      current = [];
      currentLength = 0;
    }

    current.push(sentence);
    currentLength += sentence.length;
  }

  if (current.length > 0) {
    paragraphs.push(current.join(""));
  }

  return paragraphs.join("\n\n");
}

function splitJapaneseSentences(text: string): string[] {
  const sentences: string[] = [];
  let start = 0;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char !== "。" && char !== "！" && char !== "？") {
      continue;
    }

    let end = index + 1;
    while (end < text.length && /[」』）)]/.test(text[end] ?? "")) {
      end += 1;
    }

    const sentence = text.slice(start, end).trim();
    if (sentence) {
      sentences.push(sentence);
    }
    start = end;
  }

  const rest = text.slice(start).trim();
  if (rest) {
    sentences.push(rest);
  }

  return sentences;
}
