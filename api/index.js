export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('Alice Gemini Webhook is running');
  }

  const { request, session, version, state } = req.body;
  const userQuery = request?.original_utterance || request?.command || '';
  const isNewSession = session?.new || false;

  // Если это начало диалога / приветствие
  if (isNewSession && !userQuery) {
    return res.json({
      version,
      session,
      response: {
        text: 'Привет! Я Gemini. О чём хотим поговорить?',
        end_session: false,
      },
    });
  }

  // Восстанавливаем историю диалога из session_state Яндекс Диалогов
  let history = state?.session?.history || [];

  try {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const serperApiKey = process.env.SERPER_API_KEY;

    let searchContext = '';

    // Выполняем поиск через Serper, если запрос требует актуальных данных
    if (serperApiKey) {
      try {
        const searchRes = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: {
            'X-API-KEY': serperApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ q: userQuery, gl: 'de', hl: 'ru' }),
        });
        const searchData = await searchRes.json();
        const snippets = searchData?.organic?.slice(0, 3).map(item => item.snippet).join('\n');
        if (snippets) {
          searchContext = `\n\nАктуальная информация из поиска:\n${snippets}`;
        }
      } catch (e) {
        console.error('Serper search error:', e);
      }
    }

    // Собираем сообщения для Gemini
    const contents = [
      ...history,
      {
        role: 'user',
        parts: [{ text: userQuery + searchContext }]
      }
    ];

    const systemInstruction = "Ты — голосовой ассистент Gemini в Яндекс Станции. Отвечай кратко, четко, понятно на слух, без форматирования Markdown (без звездочек, без списков, без ссылок). Ответ должен быть удобен для озвучки голосом.";

    // Запрос к Gemini 1.5 Flash (быстрая модель для голоса)
    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: contents,
      }),
    });

    const geminiData = await geminiRes.json();
    let replyText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!replyText) {
      replyText = 'Извините, не удалось получить ответ от Gemini.';
    }

    // Очищаем текст от символов Markdown, которые Алиса может плохо зачитать
    replyText = replyText.replace(/[*_#`~]/g, '');

    // Обновляем историю сессии (сохраняем последние 6 сообщений для контекста)
    const newHistory = [
      ...history,
      { role: 'user', parts: [{ text: userQuery }] },
      { role: 'model', parts: [{ text: replyText }] }
    ].slice(-6);

    return res.json({
      version,
      session,
      response: {
        text: replyText,
        end_session: false,
      },
      session_state: {
        history: newHistory
      }
    });

  } catch (error) {
    console.error('Error:', error);
    return res.json({
      version,
      session,
      response: {
        text: 'Произошла ошибка при обработке запроса.',
        end_session: false,
      },
    });
  }
}
