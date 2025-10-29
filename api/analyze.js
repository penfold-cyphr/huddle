// api/analyze.js - Vercel Serverless Function (Node.js)

// IMPORTANT: Do NOT use import/export syntax here unless you configure package.json type="module"
// Standard Node.js 'require' is safer for basic Vercel functions.

// Use node-fetch v2 if you are in a CommonJS environment (default for Vercel Node.js 18.x)
// Run: npm install node-fetch@2
const fetch = require('node-fetch');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // Access environment variable
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GEMINI_API_KEY}`;

// Re-define constants needed from the frontend
const SYSTEM_PROMPT = `
You are 'The Huddle,' an AI performance-psychology assistant. You are analyzing a
private, transcribed audio log from a professional athlete or coach.
Your tone is supportive, analytical, and 100% confidential.

Do not be conversational (e.g., 'Hello!'). Get straight to the analysis.
The user just vented or reflected on the following text.

Analyze it and return a JSON object with the following structure.
Do not return a markdown block (e.g., \`\`\`json). Return ONLY the raw JSON object.

The JSON object must have three keys:
1. "emotions": An array of 3-5 detected emotions, mindsets, or feeling states observed in the text.
2. "themes": An array of 3-5 key topics or recurring mental patterns identified in the text.
3. "insight": A 2-3 sentence actionable insight OR a constructive reframing question for the user to consider, based *specifically* on their provided text. Keep it concise and directly relevant.
`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    "emotions": { type: "ARRAY", description: "List of 3-5 detected emotions or mindsets.", items: { type: "STRING" } },
    "themes": { type: "ARRAY", description: "List of 3-5 key topics or mental patterns.", items: { type: "STRING" } },
    "insight": { type: "STRING", description: "A concise 2-3 sentence actionable insight or reframing question." }
  },
  required: ["emotions", "themes", "insight"]
};


// Main function handler for Vercel
module.exports = async (req, res) => {
  // Allow requests only from your Vercel domain in production
  // Allow all for local development (adjust origin as needed)
  // Determine the correct origin header based on the environment
    const deploymentUrl = process.env.VERCEL_URL; // Vercel provides this
    const allowedOrigin = deploymentUrl ? `https://${deploymentUrl}` : 'http://localhost:5173'; // Default to localhost if not on Vercel


  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin); // More specific origin
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Optional: Allow credentials if needed later, though not for this simple proxy
  // res.setHeader('Access-Control-Allow-Credentials', 'true');


  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Check if API key is configured
  if (!GEMINI_API_KEY) {
    console.error('Gemini API key not configured in environment variables.');
    return res.status(500).json({ error: 'API key not configured on server.' });
  }

  // Get text from request body
  const { text } = req.body;

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({ error: 'Request body must contain non-empty "text" field.' });
  }

  // Construct Gemini payload
  const payload = {
    contents: [{ parts: [{ text: text }] }],
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.7,
    }
  };

  try {
    // Call Gemini API with exponential backoff
    let apiResponse;
    let retries = 0;
    const maxRetries = 3;
    let delay = 1000;
    let lastError = null;

    while (retries < maxRetries) {
      try {
        apiResponse = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (apiResponse.ok) {
          lastError = null; // Reset error on success
          break; // Success
        }

        // Specific handling for common errors
        if (apiResponse.status === 400) {
            const errorBody = await apiResponse.json();
            console.error("Gemini API Bad Request (400):", errorBody);
            lastError = new Error(`Invalid request to Gemini: ${errorBody.error?.message || 'Check payload/schema.'}`);
            break; // Don't retry client errors like bad requests
        } else if (apiResponse.status === 429 || apiResponse.status >= 500) {
            console.warn(`Gemini API returned ${apiResponse.status}. Retrying in ${delay / 1000}s...`);
            lastError = new Error(`API call failed with status: ${apiResponse.status}`);
            retries++;
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2;
        } else {
             const errorText = await apiResponse.text();
            console.error(`Gemini API unexpected error ${apiResponse.status}:`, errorText);
            lastError = new Error(`API call failed with status: ${apiResponse.status}`);
            break; // Don't retry other unexpected client errors
        }

      } catch (fetchError) {
        lastError = fetchError; // Store the fetch error
        console.warn(`Fetch attempt ${retries + 1} failed: ${fetchError.message}. Retrying in ${delay / 1000}s...`);
        retries++;
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
      }
    }

    // Check if we exhausted retries or encountered a non-retryable error
    if (lastError) {
       throw lastError; // Throw the last recorded error
    }

    if (!apiResponse || !apiResponse.ok) {
      throw new Error(`API call failed after retries. Last status: ${apiResponse?.status}`);
    }


    const result = await apiResponse.json();

    // Securely send only the necessary part of the response back to the client
    if (result.candidates && result.candidates[0].content?.parts?.[0]?.text) {
      const jsonText = result.candidates[0].content.parts[0].text;
      try {
          // Parse internally first to ensure it's valid JSON before sending
          const parsedJson = JSON.parse(jsonText);
          res.status(200).json(parsedJson); // Send the already parsed JSON object
      } catch (parseError) {
           console.error("Backend failed to parse Gemini JSON response:", jsonText, parseError);
           res.status(500).json({ error: "AI returned invalid JSON format." });
      }

    } else {
      console.error("Backend received unexpected API response structure:", JSON.stringify(result, null, 2));
       if (result.promptFeedback?.blockReason) {
            res.status(400).json({ error: `AI request blocked: ${result.promptFeedback.blockReason}` });
       } else {
           res.status(500).json({ error: "Failed to parse insights from AI response." });
       }
    }

  } catch (error) {
    console.error('Error in /api/analyze function:', error);
    res.status(500).json({ error: `Server error processing request: ${error.message}` });
  }
};

