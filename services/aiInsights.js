const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5";
const OPENAI_API_URL = "https://api.openai.com/v1/responses";

function buildPrompt(question, analytics) {
  const compactPayload = {
    overview: analytics.overview,
    topEmployees: analytics.employees
      .map((employee) => ({
        name: employee.name,
        mainDuty: employee.mainDuty,
        secondaryDuty: employee.secondaryDuty,
        achievementRate: employee.achievementRate,
        operationSuccessRate: employee.operationSuccessRate,
        successCount: employee.successCount,
        failureCount: employee.failureCount
      }))
      .slice(0, 10),
    riskOperations: analytics.operations
      .map((operation) => ({
        operationName: operation.operationName,
        difficulty: operation.difficulty,
        participantCount: operation.participantCount,
        successCount: operation.successCount,
        failureCount: operation.failureCount,
        achievementRate: operation.achievementRate,
        operationSuccessRate: operation.operationSuccessRate
      }))
      .sort((left, right) => {
        if (left.operationSuccessRate !== right.operationSuccessRate) {
          return left.operationSuccessRate - right.operationSuccessRate;
        }

        return (right.difficulty || 0) - (left.difficulty || 0);
      })
      .slice(0, 15)
  };

  return [
    "Sen bir uretim yetkinlik matrisi analiz asistanisin.",
    "Verilen veriye dayanarak net, denetlenebilir ve yoneticiye uygun bir analiz yaz.",
    "Varsayim uretme; sadece veride desteklenen noktalar uzerinden git.",
    "Cevap su bolumleri icersin:",
    "1. Kisa genel ozet",
    "2. En kritik 3 risk",
    "3. Egitim veya aksiyon onceligi olan personeller",
    "4. Operasyonel oneriler",
    "",
    `Kullanici sorusu: ${question}`,
    "",
    "Veri ozeti:",
    JSON.stringify(compactPayload, null, 2)
  ].join("\n");
}

async function generateAiInsights(question, analytics) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    const error = new Error("OPENAI_API_KEY tanimli degil");
    error.statusCode = 503;
    throw error;
  }

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      input: buildPrompt(question, analytics),
      reasoning: {
        effort: "medium"
      },
      text: {
        format: {
          type: "text"
        },
        verbosity: "medium"
      }
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    const error = new Error(`OpenAI istegi basarisiz oldu: ${response.status}`);
    error.statusCode = response.status;
    error.details = errorBody;
    throw error;
  }

  const payload = await response.json();

  return {
    model: payload.model || DEFAULT_MODEL,
    responseId: payload.id || null,
    outputText: payload.output_text || ""
  };
}

module.exports = {
  generateAiInsights
};
