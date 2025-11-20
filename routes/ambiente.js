/**
 * Rotas de Ambiente (para usuários dos ambientes criados)
 * Permite que cada ambiente gerencie suas próprias credenciais
 */

const express = require('express');
const router = express.Router();

const {
  authenticateAmbiente,
  getAmbiente
} = require('../utils/database');

const {
  obterCredenciaisBanco,
  atualizarCredenciaisBanco
} = require('../utils/ambiente-manager');

// Middleware de autenticação de ambiente
function requireAmbienteAuth(req, res, next) {
  const ambienteId = req.headers['x-ambiente-id'];
  const username = req.headers['x-username'];
  const password = req.headers['x-password'];
  
  if (!ambienteId || !username || !password) {
    return res.status(401).json({
      success: false,
      error: 'Credenciais de ambiente necessárias'
    });
  }
  
  const auth = authenticateAmbiente(ambienteId, username, password);
  
  if (!auth.success) {
    return res.status(401).json({
      success: false,
      error: auth.error
    });
  }
  
  req.ambiente = auth.ambiente;
  next();
}

// Login do ambiente
router.post('/login', (req, res) => {
  try {
    const { ambienteId, username, password } = req.body;
    
    if (!ambienteId || !username || !password) {
      return res.status(400).json({
        success: false,
        error: 'ambienteId, username e password são obrigatórios'
      });
    }
    
    const auth = authenticateAmbiente(ambienteId, username, password);
    
    if (auth.success) {
      res.json({
        success: true,
        ambiente: auth.ambiente,
        token: `ambiente-token-${ambienteId}-${Date.now()}`
      });
    } else {
      res.status(401).json({
        success: false,
        error: auth.error
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao fazer login',
      message: error.message
    });
  }
});

// Listar bancos permitidos do ambiente
router.get('/bancos', requireAmbienteAuth, (req, res) => {
  try {
    const ambiente = getAmbiente(req.ambiente.id);
    
    res.json({
      success: true,
      bancos: ambiente.bancosPermitidos.map(bancoId => ({
        id: bancoId,
        nome: bancoId === 'presencabank' ? 'Presença Bank' :
              bancoId === 'v8' ? 'V8 Digital' :
              bancoId === 'hubcredito' ? 'HubCredito' : bancoId
      }))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao listar bancos',
      message: error.message
    });
  }
});

// Obter credenciais de banco
router.get('/bancos/:bancoId/credenciais', requireAmbienteAuth, (req, res) => {
  try {
    const { bancoId } = req.params;
    
    // Verificar se banco é permitido
    if (!req.ambiente.bancosPermitidos.includes(bancoId)) {
      return res.status(403).json({
        success: false,
        error: 'Banco não permitido para este ambiente'
      });
    }
    
    const resultado = obterCredenciaisBanco(req.ambiente.id, bancoId);
    
    if (!resultado.success) {
      return res.status(404).json(resultado);
    }
    
    res.json({
      success: true,
      credenciais: resultado.credenciais
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao obter credenciais',
      message: error.message
    });
  }
});

// Atualizar credenciais de banco
router.put('/bancos/:bancoId/credenciais', requireAmbienteAuth, (req, res) => {
  try {
    const { bancoId } = req.params;
    const { login, senha } = req.body;
    
    // Verificar se banco é permitido
    if (!req.ambiente.bancosPermitidos.includes(bancoId)) {
      return res.status(403).json({
        success: false,
        error: 'Banco não permitido para este ambiente'
      });
    }
    
    if (!login && !senha) {
      return res.status(400).json({
        success: false,
        error: 'Login ou senha devem ser fornecidos'
      });
    }
    
    const resultado = atualizarCredenciaisBanco(req.ambiente.id, bancoId, { login, senha });
    
    if (!resultado.success) {
      return res.status(400).json(resultado);
    }
    
    res.json({
      success: true,
      message: resultado.message
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao atualizar credenciais',
      message: error.message
    });
  }
});

module.exports = router;
