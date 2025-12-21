// 简单的 API 测试脚本
import OpenAI from 'openai';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 手动读取 .env.local 文件
let apiKey, baseURL;
try {
  const envContent = readFileSync(join(__dirname, '.env.local'), 'utf-8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      const value = valueParts.join('=').trim();
      if (key === 'OPENAI_API_KEY') apiKey = value;
      if (key === 'OPENAI_BASE_URL') baseURL = value;
    }
  });
} catch (e) {
  console.warn('无法读取 .env.local 文件，尝试使用环境变量');
}

// 如果文件读取失败，尝试从环境变量获取
apiKey = apiKey || process.env.OPENAI_API_KEY;
baseURL = baseURL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

console.log('🔍 检查配置...');
console.log('API Key:', apiKey ? `${apiKey.substring(0, 10)}...` : '❌ 未设置');
console.log('Base URL:', baseURL);
console.log('');

if (!apiKey) {
  console.error('❌ 错误: OPENAI_API_KEY 未设置');
  process.exit(1);
}

const openai = new OpenAI({
  apiKey: apiKey,
  baseURL: baseURL
});

console.log('🚀 测试 API 连接...');
console.log('');

async function testAPI() {
  try {
    // 从环境变量或 .env.local 读取模型名称
    let modelName = process.env.OPENAI_MODEL || 'bce/deepseek-v3.2';
    
    // 如果从文件读取，尝试从 .env.local 获取
    if (!modelName || modelName === 'undefined') {
      try {
        const envContent = readFileSync(join(__dirname, '.env.local'), 'utf-8');
        envContent.split('\n').forEach(line => {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            const [key, ...valueParts] = trimmed.split('=');
            const value = valueParts.join('=').trim();
            if (key === 'OPENAI_MODEL') modelName = value;
          }
        });
      } catch (e) {
        // 忽略错误，使用默认值
      }
    }
    
    modelName = modelName || 'bce/deepseek-v3.2';
    console.log(`使用模型: ${modelName}`);
    
    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        { role: 'system', content: 'You are a helpful assistant. Respond with JSON format.' },
        { role: 'user', content: 'Say "Hello, API is working!" in Chinese. Return as JSON: {"message": "your response"}' }
      ],
      response_format: { type: "json_object" },
      max_tokens: 50,
    });

    const content = response.choices[0]?.message?.content;
    console.log('✅ API 调用成功!');
    console.log('📝 响应内容:', content);
    console.log('');
    console.log('🎉 配置正确，可以正常使用!');
  } catch (error) {
    console.error('❌ API 调用失败:');
    console.error(error.message);
    if (error.status) {
      console.error('状态码:', error.status);
    }
    process.exit(1);
  }
}

testAPI();

