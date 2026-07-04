import { relative } from "node:path";

export function buildRunInputMetadata({ questionsPath, questions, tickerInput, workersDir }) {
  return {
    questionsPath: toWorkersRelativePath(questionsPath, workersDir),
    companySetPath: tickerInput.companySetPath,
    questionTemplateCount: questions.length,
    companyTickerCount: tickerInput.tickers.length
  };
}

export function resolveTickerInput({ inlineTickers = [], companySetTickers, companySetPath, workersDir }) {
  if (inlineTickers.length > 0) {
    return {
      tickers: normalizeTickers(inlineTickers),
      companySetPath: "inline:KABUYOMI_TESTBENCH_TICKERS"
    };
  }

  if (!Array.isArray(companySetTickers) || companySetTickers.length === 0) {
    throw new Error(`${companySetPath} must contain a non-empty tickers array`);
  }

  return {
    tickers: normalizeTickers(companySetTickers),
    companySetPath: toWorkersRelativePath(companySetPath, workersDir)
  };
}

export function toWorkersRelativePath(path, workersDir) {
  const relativePath = relative(workersDir, path).replace(/\\/g, "/");
  return relativePath.startsWith("..") ? path : relativePath;
}

function normalizeTickers(tickers) {
  return tickers.map((ticker) => String(ticker).trim().toUpperCase()).filter(Boolean);
}
