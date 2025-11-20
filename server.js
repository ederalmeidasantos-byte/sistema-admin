/**
 * Servidor de Administração
 * Sistema de gerenciamento de ambientes e permissões
 */

const express = require('express');
const cors = require('cors');
const https = require('https');
// const helmet = require('helmet'); // Temporariamente desabilitado para desenvolvimento
const path = require('path');
const fs = require('fs');

// Carregar .env se existir
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
}

const app = express();
const PORT = process.env.PORT || 7000;
const HTTPS_PORT = process.env.HTTPS_PORT || 7443;
const HOST = process.env.HOST || '0.0.0.0';

// Middleware - Helmet temporariamente desabilitado para desenvolvimento
// app.use(helmet()); // Desabilitado para evitar problemas de CSP

// Remover headers de segurança que forçam HTTPS
app.use((req, res, next) => {
  // Interceptar setHeader para remover headers problemáticos
  const originalSetHeader = res.setHeader.bind(res);
  res.setHeader = function(name, value) {
    const lowerName = name.toLowerCase();
    if (lowerName === 'strict-transport-security' || 
        lowerName === 'content-security-policy' ||
        lowerName === 'cross-origin-opener-policy' ||
        lowerName === 'cross-origin-embedder-policy' ||
        lowerName === 'origin-agent-cluster') {
      return; // Não definir esses headers
    }
    return originalSetHeader(name, value);
  };
  
  // Remover headers existentes
  res.removeHeader('Strict-Transport-Security');
  res.removeHeader('Content-Security-Policy');
  res.removeHeader('Cross-Origin-Opener-Policy');
  res.removeHeader('Cross-Origin-Embedder-Policy');
  res.removeHeader('Origin-Agent-Cluster');
  
  next();
});

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Ambiente-Id', 'X-Username', 'X-Password']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir arquivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Rotas
const adminRoutes = require('./routes/admin');
const ambienteRoutes = require('./routes/ambiente');

app.use('/api/admin', adminRoutes);
app.use('/api/ambiente', ambienteRoutes);

// Rota raiz
app.get('/', (req, res) => {
  // Garantir que headers problemáticos não sejam enviados
  res.removeHeader('Strict-Transport-Security');
  res.removeHeader('Content-Security-Policy');
  res.removeHeader('Cross-Origin-Opener-Policy');
  res.removeHeader('Cross-Origin-Embedder-Policy');
  res.removeHeader('Origin-Agent-Cluster');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Sistema de Administração',
    timestamp: new Date().toISOString(),
    port: PORT
  });
});

// Middleware final para garantir remoção de headers problemáticos
app.use((req, res, next) => {
  // Interceptar writeHead para remover headers antes de enviar
  const originalWriteHead = res.writeHead.bind(res);
  res.writeHead = function(statusCode, statusMessage, headers) {
    if (typeof statusMessage === 'object') {
      headers = statusMessage;
      statusMessage = undefined;
    }
    
    if (headers) {
      // Remover headers problemáticos
      delete headers['strict-transport-security'];
      delete headers['Strict-Transport-Security'];
      delete headers['content-security-policy'];
      delete headers['Content-Security-Policy'];
      delete headers['cross-origin-opener-policy'];
      delete headers['Cross-Origin-Opener-Policy'];
      delete headers['cross-origin-embedder-policy'];
      delete headers['Cross-Origin-Embedder-Policy'];
      delete headers['origin-agent-cluster'];
      delete headers['Origin-Agent-Cluster'];
      
      // Remover upgrade-insecure-requests do CSP se existir
      if (headers['content-security-policy'] || headers['Content-Security-Policy']) {
        const csp = (headers['content-security-policy'] || headers['Content-Security-Policy'] || '').toString();
        const newCsp = csp.replace(/upgrade-insecure-requests[;]?/gi, '').trim();
        if (newCsp) {
          headers['content-security-policy'] = newCsp;
          headers['Content-Security-Policy'] = newCsp;
        } else {
          delete headers['content-security-policy'];
          delete headers['Content-Security-Policy'];
        }
      }
    }
    
    return originalWriteHead(statusCode, statusMessage, headers);
  };
  
  next();
});

// Tratamento de erros
app.use((err, req, res, next) => {
  console.error('❌ Erro:', err);
  res.status(500).json({
    success: false,
    error: 'Erro interno do servidor',
    message: err.message
  });
});

// Carregar certificados SSL se existirem
let httpsOptions = null;
try {
  const certPath = '/etc/letsencrypt/live/lunasdigital.com.br/fullchain.pem';
  const keyPath = '/etc/letsencrypt/live/lunasdigital.com.br/privkey.pem';
  
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    httpsOptions = {
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath)
    };
    console.log('✅ Certificados SSL carregados com sucesso');
  } else {
    console.log('⚠️ Certificados SSL não encontrados, servindo apenas HTTP');
  }
} catch (error) {
  console.log('⚠️ Erro ao carregar certificados SSL:', error.message);
}

// Iniciar servidor HTTP
app.listen(PORT, HOST, () => {
  console.log(`\n🔐 ===== SISTEMA DE ADMINISTRAÇÃO =====`);
  console.log(`🌐 Servidor HTTP rodando em: http://${HOST}:${PORT}`);
  console.log(`🌍 Acesso externo HTTP: http://72.60.159.149:${PORT}`);
  console.log(`📊 Health check HTTP: http://72.60.159.149:${PORT}/health`);
  if (httpsOptions) {
    console.log(`🔒 Servidor HTTPS será iniciado na porta ${HTTPS_PORT}`);
  }
  console.log(`🔧 Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log(`⏰ Iniciado em: ${new Date().toLocaleString('pt-BR')}`);
  console.log(`========================================\n`);
});

// Iniciar servidor HTTPS se certificados estiverem disponíveis
if (httpsOptions) {
  const httpsServer = https.createServer(httpsOptions, app);
  httpsServer.listen(HTTPS_PORT, HOST, () => {
    console.log(`🔒 Servidor HTTPS rodando na porta ${HTTPS_PORT}`);
    console.log(`🌍 Acesso externo HTTPS: https://72.60.159.149:${HTTPS_PORT}`);
    console.log(`🌐 Acesso via domínio: https://lunasdigital.com.br:${HTTPS_PORT}`);
    console.log(`📊 Health check HTTPS: https://72.60.159.149:${HTTPS_PORT}/health`);
  });
  
  httpsServer.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`❌ Porta ${HTTPS_PORT} já está em uso`);
    } else {
      console.error('❌ Erro no servidor HTTPS:', error);
    }
  });
}

module.exports = app;
