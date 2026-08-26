import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { accessHeaders } from "./access-headers.ts";

function keychainPassword(service: string): string | undefined {
  try {
    return execFileSync("/usr/bin/security", ["find-generic-password", "-a", process.env.MD_KEYCHAIN_ACCOUNT ?? "0xt4", "-s", service, "-w"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch { return undefined; }
}

const environment = (process.env.MD_ENVIRONMENT ?? "preview").toLowerCase();
if (!new Set(["preview", "testflight", "production"]).has(environment)) throw new Error("MD_ENVIRONMENT must be preview, testflight, or production");
const prefix = environment === "production" ? "MarketDocketProduction" : environment === "testflight" ? "MarketDocketTestFlight" : "MarketDocketPreview";
const suffix = environment === "production" ? "prod" : environment;
const baseURL = process.env.MD_ADMIN_URL?.replace(/\/$/, "") ?? `https://md-admin-${suffix}.dznqjmctk7.workers.dev`;
const token = process.env.MD_ADMIN_TOKEN ?? keychainPassword(`${prefix}Admin`);
if (!token) throw new Error(`${prefix}Admin token is unavailable`);

const revision = Number(process.argv[2]);
const pdfPath = process.argv[3];
const textPath = process.argv[4];
if (![1, 2].includes(revision) || !pdfPath || !textPath) throw new Error("Usage: submit-bis-vertical-slice.ts <1|2> <official.pdf> <extracted.txt>");

const eventID = "9cb65e97-dc25-43ff-8c51-2efb6cc44618";
const finalRuleDocumentID = "cb10538b-96f1-43ca-a6d5-a24077411a9f";
const correctionDocumentID = "ee524680-9145-4a85-9ed5-e913a24af766";
const pdf = await readFile(pdfPath);
const bodyText = await readFile(textPath, "utf8");

const common = {
  sourceCode: "BIS",
  eventID,
  titleJA: "中国・マカオ向け核不拡散輸出管理の拡大",
  titleEN: "Expansion of Nuclear Nonproliferation Controls on the People's Republic of China and Macau",
  publisherJA: "米国商務省産業安全保障局",
  publisherEN: "Bureau of Industry and Security",
  bodyText,
  rawBodyBase64: pdf.toString("base64"),
  contentType: "application/pdf"
};

const version = revision === 1 ? {
  documentID: finalRuleDocumentID,
  externalID: "2023-17243",
  sourceURL: "https://public-inspection.federalregister.gov/2023-17243.pdf",
  documentNumber: "FR Doc. 2023-17243",
  revisionNumber: 1,
  documentType: "final_rule",
  relationship: "primary",
  publishedOn: "2023-08-14",
  effectiveOn: "2023-08-11",
  sourceStatedAt: "Filed 8/11/2023 8:45 am",
  availableAt: "2023-08-14T00:00:00Z",
  availabilityBasis: "publication_date_only",
  timePrecision: "day",
  displayBodyJA: "中国とマカオに対し、核不拡散を理由とする追加の輸出管理を導入した最終規則。掲載日は確認済みですが、PDF記載時刻のタイムゾーンは未確定です。",
  displayBodyEN: "The final rule adds nuclear nonproliferation export controls for China and Macau. Its publication date is verified; the timezone of the filed time printed in the PDF is not established."
} : {
  documentID: correctionDocumentID,
  externalID: "2023-18047",
  sourceURL: "https://public-inspection.federalregister.gov/2023-18047.pdf",
  documentNumber: "FR Doc. 2023-18047",
  revisionNumber: 1,
  documentType: "correcting_amendment",
  relationship: "corrects",
  correctsDocumentID: finalRuleDocumentID,
  publishedOn: "2023-08-21",
  effectiveOn: "2023-08-17",
  applicableOn: "2023-08-11",
  sourceStatedAt: "Filed 8/17/2023 4:15 pm",
  availableAt: "2023-08-21T00:00:00Z",
  availabilityBasis: "publication_date_only",
  timePrecision: "day",
  displayBodyJA: "2023年8月14日掲載の最終規則について、規制指示の意図しない誤りを修正した訂正文書。適用開始日は2023年8月11日とされています。",
  displayBodyEN: "The correcting amendment fixes an inadvertent error in a regulatory instruction in the August 14 final rule and states that the corrected text applies beginning August 11, 2023.",
  changeSummaryJA: "規制指示の誤りを訂正し、中国・マカオのCommerce Country Chart項目を修正"
};

const response = await fetch(baseURL + "/admin/ingests", {
  method: "POST",
  headers: {
    ...accessHeaders(),
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    accept: "application/json"
  },
  body: JSON.stringify({ ...common, ...version })
});
const text = await response.text();
if (!response.ok) throw new Error(`submit failed: ${response.status} ${text}`);
process.stdout.write(text + "\n");
