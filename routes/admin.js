/**
 * Rotas de Administração
 * Gerencia ambientes, permissões e sincronização
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

const {
  authenticateAdmin,
  authenticateLogin,
  createAmbiente,
  listAmbientes,
  getAmbiente,
  updateBancosPermitidos,
  updateAmbiente,
  getBancosDisponiveis,
  updateBancosDisponiveis,
  deleteAmbiente,
  sincronizarAmbientesExistentes,
  listPerfis,
  getPerfil,
  createPerfil,
  updatePerfil,
  deletePerfil,
  listLogins,
  getLogin,
  createLogin,
  updateLogin,
  deleteLogin
} = require('../utils/database');

const {
  detectarBancosDisponiveis,
  criarEstruturaAmbiente,
  sincronizarBanco,
  sincronizarAmbiente,
  sincronizarTodosAmbientes,
  atualizarCredenciaisBanco,
  obterCredenciaisBanco,
  obterCredenciaisBancoTodosAmbientes,
  atualizarCredenciaisBancoAmbiente
} = require('../utils/ambiente-manager');

const {
  obterStatusServidor,
  iniciarServidor,
  pararServidor,
  reiniciarServidor,
  obterStatusTodosServidores
} = require('../utils/pm2-manager');

// Middleware de autenticação admin ou login
function requireAdmin(req, res, next) {
  const token = req.headers.authorization || req.query.token || req.body.token;
  
  // Em desenvolvimento, permitir acesso sem token (compatibilidade)
  if (!token) {
    return next();
  }
  
  // Verificar se token é válido (admin-token-{timestamp} ou login-token-{loginId}-{timestamp})
  if (typeof token === 'string') {
    if (token.startsWith('admin-token-')) {
      // Token de admin - validar timestamp
      const timestamp = parseInt(token.replace('admin-token-', ''));
      if (isNaN(timestamp)) {
        // return res.status(401).json({ success: false, error: 'Token inválido' });
      }
    } else if (token.startsWith('login-token-')) {
      // Token de login - permitir (validação será feita por permissões específicas se necessário)
      // Formato: login-token-{loginId}-{timestamp}
    } else {
      // Token desconhecido - em desenvolvimento permitir
      // return res.status(401).json({ success: false, error: 'Token inválido' });
    }
  }
  
  next();
}

// Login (Admin ou Login criado)
router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Username e password são obrigatórios',
        errorCode: 'MISSING_CREDENTIALS'
      });
    }
    
    // Tentar autenticar como admin primeiro
    const authAdmin = authenticateAdmin(username, password);
    
    if (authAdmin.success) {
      // Em produção, gerar JWT token aqui
      return res.json({
        success: true,
        usuario: authAdmin.usuario,
        tipo: 'admin',
        token: 'admin-token-' + Date.now() // Token temporário
      });
    }
    
    // Se não for admin, tentar como login criado
    const authLogin = authenticateLogin(username, password);
    
    if (authLogin.success) {
      // Verificar se login está ativo
      if (!authLogin.login.ativo) {
        return res.status(401).json({
          success: false,
          error: 'Usuário inativo. Entre em contato com o administrador.',
          errorCode: 'USER_INACTIVE'
        });
      }
      
      // Verificar se ambiente existe e está ativo
      if (!authLogin.ambiente) {
        return res.status(401).json({
          success: false,
          error: 'Ambiente associado não encontrado',
          errorCode: 'AMBIENTE_NOT_FOUND'
        });
      }
      
      if (!authLogin.ambiente.ativo) {
        return res.status(401).json({
          success: false,
          error: 'Ambiente associado está inativo',
          errorCode: 'AMBIENTE_INACTIVE'
        });
      }
      
      // Verificar se perfil existe e está ativo (se houver perfil)
      if (authLogin.login.perfilId && !authLogin.perfil) {
        return res.status(401).json({
          success: false,
          error: 'Perfil associado não encontrado ou inativo',
          errorCode: 'PERFIL_NOT_FOUND'
        });
      }
      
      return res.json({
        success: true,
        login: {
          id: authLogin.login.id,
          username: authLogin.login.username,
          ambienteId: authLogin.login.ambienteId,
          perfilId: authLogin.login.perfilId
        },
        ambiente: authLogin.ambiente,
        perfil: authLogin.perfil,
        tipo: 'login',
        token: 'login-token-' + authLogin.login.id + '-' + Date.now()
      });
    }
    
    // Se chegou aqui, nenhuma autenticação funcionou
    // Verificar qual foi o erro específico
    if (authAdmin.error === 'Usuário não encontrado' && authLogin.error) {
      // Login não encontrado ou inativo
      if (authLogin.error.includes('inativo')) {
        return res.status(401).json({
          success: false,
          error: 'Usuário inativo. Entre em contato com o administrador.',
          errorCode: 'USER_INACTIVE'
        });
      }
      return res.status(401).json({
        success: false,
        error: 'Usuário não encontrado',
        errorCode: 'USER_NOT_FOUND'
      });
    }
    
    if (authLogin.error && authLogin.error.includes('Senha incorreta')) {
      return res.status(401).json({
        success: false,
        error: 'Senha incorreta',
        errorCode: 'INVALID_PASSWORD'
      });
    }
    
    // Erro genérico
    return res.status(401).json({
      success: false,
      error: 'Usuário ou senha inválidos',
      errorCode: 'INVALID_CREDENTIALS'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao fazer login',
      errorCode: 'SERVER_ERROR',
      message: error.message
    });
  }
});

// Validar token (admin ou login criado)
router.post('/validar-token', (req, res) => {
  try {
    // Tentar obter token de várias formas
    let token = null;
    
    // 1. Do header Authorization (Bearer token ou token direto)
    const authHeader = req.headers.authorization;
    if (authHeader) {
      if (authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
      } else {
        token = authHeader;
      }
    }
    
    // 2. Do body
    if (!token && req.body.token) {
      token = req.body.token;
    }
    
    // 3. Do query string (fallback)
    if (!token && req.query.token) {
      token = req.query.token;
    }
    
    if (!token) {
      return res.status(401).json({
        success: false,
        isValid: false,
        error: 'Token não fornecido'
      });
    }
    
    // Validar formato do token (admin-token-{timestamp} ou login-token-{loginId}-{timestamp})
    // Em produção, usar JWT e verificar assinatura
    if (typeof token === 'string') {
      const agora = Date.now();
      const umDia = 24 * 60 * 60 * 1000; // 24 horas em milissegundos
      
      if (token.startsWith('admin-token-')) {
        // Token de admin: admin-token-{timestamp}
        const timestamp = parseInt(token.replace('admin-token-', ''));
        
        if (isNaN(timestamp) || (agora - timestamp) > umDia) {
          return res.status(401).json({
            success: false,
            isValid: false,
            error: 'Token expirado'
          });
        }
        
        return res.json({
          success: true,
          isValid: true,
          tipo: 'admin',
          message: 'Token válido'
        });
      } else if (token.startsWith('login-token-')) {
        // Token de login: login-token-{loginId}-{timestamp}
        const partes = token.replace('login-token-', '').split('-');
        if (partes.length < 2) {
          return res.status(401).json({
            success: false,
            isValid: false,
            error: 'Token inválido'
          });
        }
        
        const timestamp = parseInt(partes[partes.length - 1]);
        const loginId = partes.slice(0, -1).join('-');
        
        if (isNaN(timestamp) || (agora - timestamp) > umDia) {
          return res.status(401).json({
            success: false,
            isValid: false,
            error: 'Token expirado'
          });
        }
        
        // Verificar se o login ainda existe e está ativo
        const { getLogin } = require('../utils/database');
        const login = getLogin(loginId);
        
        if (!login) {
          return res.status(401).json({
            success: false,
            isValid: false,
            error: 'Login não encontrado'
          });
        }
        
        if (!login.ativo) {
          return res.status(401).json({
            success: false,
            isValid: false,
            error: 'Login inativo'
          });
        }
        
        // Verificar se ambiente está ativo
        const { getAmbiente } = require('../utils/database');
        const ambiente = getAmbiente(login.ambienteId);
        if (!ambiente || !ambiente.ativo) {
          return res.status(401).json({
            success: false,
            isValid: false,
            error: 'Ambiente inativo'
          });
        }
        
        // Verificar se perfil está ativo (se houver)
        if (login.perfilId) {
          const { getPerfil } = require('../utils/database');
          const perfil = getPerfil(login.perfilId);
          if (!perfil || !perfil.ativo) {
            return res.status(401).json({
              success: false,
              isValid: false,
              error: 'Perfil inativo'
            });
          }
        }
        
        // Buscar perfil associado
        let perfil = null;
        if (login.perfilId) {
          const { getPerfil } = require('../utils/database');
          perfil = getPerfil(login.perfilId);
        }
        
        return res.json({
          success: true,
          isValid: true,
          tipo: 'login',
          loginId: loginId,
          login: {
            id: login.id,
            username: login.username,
            ambienteId: login.ambienteId,
            perfilId: login.perfilId
          },
          ambiente: ambiente,
          perfil: perfil,
          permissoes: perfil ? perfil.permissoes : null,
          message: 'Token válido'
        });
      }
    }
    
    // Token com formato desconhecido
    res.status(401).json({
      success: false,
      isValid: false,
      error: 'Token inválido'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      isValid: false,
      error: 'Erro ao validar token',
      message: error.message
    });
  }
});

// Listar bancos disponíveis na rota-4000
router.get('/bancos-disponiveis', requireAdmin, (req, res) => {
  try {
    const bancos = detectarBancosDisponiveis();
    const bancosDB = getBancosDisponiveis();
    
    // Atualizar banco de dados com bancos detectados
    updateBancosDisponiveis(bancos);
    
    res.json({
      success: true,
      bancos: bancos,
      bancosDB: bancosDB
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao listar bancos disponíveis',
      message: error.message
    });
  }
});

// Obter credenciais de um banco em todos os ambientes
router.get('/bancos/:bancoId/credenciais', requireAdmin, (req, res) => {
  try {
    const { bancoId } = req.params;
    const resultado = obterCredenciaisBancoTodosAmbientes(bancoId);
    
    res.json(resultado);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao obter credenciais do banco',
      message: error.message
    });
  }
});

// Atualizar credenciais de banco em um ambiente específico
router.put('/bancos/:bancoId/ambientes/:ambienteId/credenciais', requireAdmin, async (req, res) => {
  try {
    const { bancoId, ambienteId } = req.params;
    const { login, senha, validarToken = true } = req.body;
    
    if (!login && !senha) {
      return res.status(400).json({
        success: false,
        error: 'Login ou senha devem ser fornecidos'
      });
    }
    
    const resultado = await atualizarCredenciaisBancoAmbiente(ambienteId, bancoId, { login, senha }, validarToken);
    
    if (!resultado.success) {
      return res.status(400).json(resultado);
    }
    
    res.json({
      success: true,
      message: resultado.message,
      validacao: resultado.validacao
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao atualizar credenciais',
      message: error.message
    });
  }
});

// Listar ambientes
router.get('/ambientes', requireAdmin, (req, res) => {
  try {
    const ambientes = listAmbientes();
    res.json({
      success: true,
      ambientes: ambientes
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao listar ambientes',
      message: error.message
    });
  }
});

// Obter ambiente específico
router.get('/ambientes/:id', requireAdmin, (req, res) => {
  try {
    const ambiente = getAmbiente(req.params.id);
    
    if (!ambiente) {
      return res.status(404).json({
        success: false,
        error: 'Ambiente não encontrado'
      });
    }
    
    res.json({
      success: true,
      ambiente: ambiente
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao obter ambiente',
      message: error.message
    });
  }
});

// Atualizar ambiente (nome, pipeline, etc)
router.put('/ambientes/:id', requireAdmin, (req, res) => {
  try {
    const { nome, pipelineKentro, ativo } = req.body;
    
    const resultado = updateAmbiente(req.params.id, {
      nome,
      pipelineKentro,
      ativo
    });
    
    if (!resultado.success) {
      return res.status(400).json(resultado);
    }
    
    res.json({
      success: true,
      ambiente: resultado.ambiente
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao atualizar ambiente',
      message: error.message
    });
  }
});

// Criar novo ambiente
router.post('/ambientes', requireAdmin, (req, res) => {
  try {
    const { nome, porta, username, password, bancosPermitidos, pipelineKentro } = req.body;
    
    if (!nome || !porta || !username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Nome, porta, username e password são obrigatórios'
      });
    }
    
    // Validar porta
    const portaNum = parseInt(porta);
    if (isNaN(portaNum) || portaNum < 1000 || portaNum > 9999) {
      return res.status(400).json({
        success: false,
        error: 'Porta deve ser um número entre 1000 e 9999'
      });
    }
    
    // Criar ambiente no banco de dados
    const resultado = createAmbiente(nome, portaNum, username, password, bancosPermitidos || [], pipelineKentro || null);
    
    if (!resultado.success) {
      return res.status(400).json(resultado);
    }
    
    // Criar estrutura de arquivos
    const estrutura = criarEstruturaAmbiente(portaNum, bancosPermitidos || []);
    
    res.json({
      success: true,
      ambiente: resultado.ambiente,
      estrutura: estrutura
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao criar ambiente',
      message: error.message
    });
  }
});

// Atualizar permissões de bancos de um ambiente
router.put('/ambientes/:id/bancos', requireAdmin, (req, res) => {
  try {
    const { bancosPermitidos } = req.body;
    
    if (!Array.isArray(bancosPermitidos)) {
      return res.status(400).json({
        success: false,
        error: 'bancosPermitidos deve ser um array'
      });
    }
    
    const resultado = updateBancosPermitidos(req.params.id, bancosPermitidos);
    
    if (!resultado.success) {
      return res.status(404).json(resultado);
    }
    
    // Sincronizar bancos adicionados (não bloqueia a resposta)
    try {
      const ambiente = getAmbiente(req.params.id);
      if (ambiente) {
        bancosPermitidos.forEach(bancoId => {
          try {
            const resultado = sincronizarBanco(req.params.id, bancoId);
            if (!resultado.success) {
              console.error(`Erro ao sincronizar banco ${bancoId}:`, resultado.error);
            }
          } catch (syncError) {
            console.error(`Erro ao sincronizar banco ${bancoId}:`, syncError);
          }
        });
      }
    } catch (syncError) {
      // Erro na sincronização não deve impedir a resposta de sucesso
      console.error('Erro ao sincronizar bancos:', syncError);
    }
    
    res.json({
      success: true,
      ambiente: resultado.ambiente
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao atualizar permissões',
      message: error.message
    });
  }
});

// Sincronizar ambiente da rota-4000
router.post('/ambientes/:id/sincronizar', requireAdmin, (req, res) => {
  try {
    const resultado = sincronizarAmbiente(req.params.id);
    
    res.json({
      success: true,
      message: 'Ambiente sincronizado com sucesso',
      resultados: resultado.resultados
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao sincronizar ambiente',
      message: error.message
    });
  }
});

// Sincronizar todos os ambientes (arquivos)
router.post('/sincronizar-todos', requireAdmin, (req, res) => {
  try {
    const resultado = sincronizarTodosAmbientes();
    
    res.json({
      success: true,
      message: 'Todos os ambientes sincronizados',
      resultados: resultado.resultados
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao sincronizar ambientes',
      message: error.message
    });
  }
});

// Sincronizar/Detectar ambientes existentes no sistema de arquivos
router.post('/sincronizar-ambientes', requireAdmin, (req, res) => {
  try {
    const resultado = sincronizarAmbientesExistentes();
    
    res.json({
      success: true,
      message: 'Ambientes sincronizados com sucesso',
      totalDetectados: resultado.totalDetectados,
      criados: resultado.resultados.criados,
      atualizados: resultado.resultados.atualizados,
      inativos: resultado.resultados.existentes
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao sincronizar ambientes existentes',
      message: error.message
    });
  }
});

// Deletar ambiente
router.delete('/ambientes/:id', requireAdmin, (req, res) => {
  try {
    const resultado = deleteAmbiente(req.params.id);
    
    if (!resultado.success) {
      return res.status(404).json(resultado);
    }
    
    res.json({
      success: true,
      message: 'Ambiente deletado com sucesso'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao deletar ambiente',
      message: error.message
    });
  }
});

// Obter credenciais de banco
router.get('/ambientes/:id/bancos/:bancoId/credenciais', requireAdmin, (req, res) => {
  try {
    const { id, bancoId } = req.params;
    const resultado = obterCredenciaisBanco(id, bancoId);
    
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
router.put('/ambientes/:id/bancos/:bancoId/credenciais', requireAdmin, async (req, res) => {
  try {
    const { id, bancoId } = req.params;
    const { login, senha, validarToken = true } = req.body;
    
    if (!login && !senha) {
      return res.status(400).json({
        success: false,
        error: 'Login ou senha devem ser fornecidos'
      });
    }
    
    const resultado = await atualizarCredenciaisBanco(id, bancoId, { login, senha }, validarToken);
    
    if (!resultado.success) {
      return res.status(400).json(resultado);
    }
    
    res.json({
      success: true,
      message: resultado.message,
      validacao: resultado.validacao
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao atualizar credenciais',
      message: error.message
    });
  }
});

// Testar token de banco
router.post('/bancos/:bancoId/testar-token', requireAdmin, async (req, res) => {
  try {
    const { bancoId } = req.params;
    const { login, senha, ambienteId } = req.body;
    
    if (!login || !senha) {
      return res.status(400).json({
        success: false,
        error: 'Login e senha são obrigatórios para testar o token'
      });
    }
    
    // Carregar variáveis de ambiente do ambiente se fornecido
    let envVars = {};
    if (ambienteId) {
      const { getAmbiente } = require('../utils/database');
      const ambiente = getAmbiente(ambienteId);
      if (ambiente) {
        const envPath = require('path').join(require('../utils/ambiente-manager').BASE_PATH || '/opt/lunas-digital', ambiente.path, '.env');
        if (require('fs').existsSync(envPath)) {
          require('dotenv').config({ path: envPath });
          envVars = {
            HUBCREDITO_API_URL: process.env.HUBCREDITO_API_URL,
            V8_AUTH_URL: process.env.V8_AUTH_URL,
            V8_CLIENT_ID: process.env.V8_CLIENT_ID,
            V8_AUDIENCE: process.env.V8_AUDIENCE,
            PRECENÇABANK_API_URL: process.env.PRECENÇABANK_API_URL
          };
        }
      }
    }
    
    const { validarTokenBanco } = require('../utils/validar-token-banco');
    const resultado = await validarTokenBanco(bancoId, login, senha, envVars);
    
    if (resultado.success) {
      res.json({
        success: true,
        message: resultado.message,
        token: resultado.token ? resultado.token.substring(0, 50) + '...' : null,
        lojaId: resultado.lojaId,
        cpfAtendente: resultado.cpfAtendente,
        expiresIn: resultado.expiresIn
      });
    } else {
      res.status(400).json({
        success: false,
        error: resultado.error,
        details: resultado.details
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao testar token',
      message: error.message
    });
  }
});

// Obter status do servidor de um ambiente
router.get('/ambientes/:id/servidor/status', requireAdmin, (req, res) => {
  try {
    const ambiente = getAmbiente(req.params.id);
    
    if (!ambiente) {
      return res.status(404).json({
        success: false,
        error: 'Ambiente não encontrado'
      });
    }
    
    const status = obterStatusServidor(ambiente.porta);
    
    res.json({
      success: true,
      porta: ambiente.porta,
      status: status
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao obter status do servidor',
      message: error.message
    });
  }
});

// Iniciar servidor de um ambiente
router.post('/ambientes/:id/servidor/iniciar', requireAdmin, (req, res) => {
  try {
    const ambiente = getAmbiente(req.params.id);
    
    if (!ambiente) {
      return res.status(404).json({
        success: false,
        error: 'Ambiente não encontrado'
      });
    }
    
    const resultado = iniciarServidor(ambiente.porta);
    
    if (!resultado.success) {
      return res.status(400).json(resultado);
    }
    
    res.json({
      success: true,
      message: resultado.message,
      status: resultado.status
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao iniciar servidor',
      message: error.message
    });
  }
});

// Parar servidor de um ambiente
router.post('/ambientes/:id/servidor/parar', requireAdmin, (req, res) => {
  try {
    const ambiente = getAmbiente(req.params.id);
    
    if (!ambiente) {
      return res.status(404).json({
        success: false,
        error: 'Ambiente não encontrado'
      });
    }
    
    const resultado = pararServidor(ambiente.porta);
    
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
      error: 'Erro ao parar servidor',
      message: error.message
    });
  }
});

// Reiniciar servidor de um ambiente
router.post('/ambientes/:id/servidor/reiniciar', requireAdmin, (req, res) => {
  try {
    const ambiente = getAmbiente(req.params.id);
    
    if (!ambiente) {
      return res.status(404).json({
        success: false,
        error: 'Ambiente não encontrado'
      });
    }
    
    const resultado = reiniciarServidor(ambiente.porta);
    
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
      error: 'Erro ao reiniciar servidor',
      message: error.message
    });
  }
});

// Obter status de todos os servidores
router.get('/servidores/status', requireAdmin, (req, res) => {
  try {
    const status = obterStatusTodosServidores();
    
    res.json({
      success: true,
      servidores: status
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao obter status dos servidores',
      message: error.message
    });
  }
});

// ============================================
// ROTAS DE PERFIS
// ============================================

// Listar perfis
router.get('/perfis', requireAdmin, (req, res) => {
  try {
    const perfis = listPerfis();
    res.json({
      success: true,
      perfis: perfis
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao listar perfis',
      message: error.message
    });
  }
});

// Obter perfil específico
router.get('/perfis/:id', requireAdmin, (req, res) => {
  try {
    const perfil = getPerfil(req.params.id);
    
    if (!perfil) {
      return res.status(404).json({
        success: false,
        error: 'Perfil não encontrado'
      });
    }
    
    res.json({
      success: true,
      perfil: perfil
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao obter perfil',
      message: error.message
    });
  }
});

// Criar novo perfil
router.post('/perfis', requireAdmin, (req, res) => {
  try {
    const { nome, loginsPermitidos, permissoes } = req.body;
    
    if (!nome) {
      return res.status(400).json({
        success: false,
        error: 'Nome do perfil é obrigatório'
      });
    }
    
    const resultado = createPerfil(nome, permissoes || {});
    
    if (!resultado.success) {
      return res.status(400).json(resultado);
    }
    
    res.json({
      success: true,
      perfil: resultado.perfil
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao criar perfil',
      message: error.message
    });
  }
});

// Atualizar perfil
router.put('/perfis/:id', requireAdmin, (req, res) => {
  try {
    const { nome, permissoes, ativo } = req.body;
    
    const resultado = updatePerfil(req.params.id, {
      nome,
      permissoes,
      ativo
    });
    
    if (!resultado.success) {
      return res.status(400).json(resultado);
    }
    
    res.json({
      success: true,
      perfil: resultado.perfil
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao atualizar perfil',
      message: error.message
    });
  }
});

// Deletar perfil
router.delete('/perfis/:id', requireAdmin, (req, res) => {
  try {
    const resultado = deletePerfil(req.params.id);
    
    if (!resultado.success) {
      return res.status(400).json(resultado);
    }
    
    res.json({
      success: true,
      message: 'Perfil deletado com sucesso'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao deletar perfil',
      message: error.message
    });
  }
});

// ============================================
// ROTAS DE LOGINS
// ============================================

router.get('/logins', requireAdmin, (req, res) => {
  try {
    const logins = listLogins();
    res.json({
      success: true,
      logins: logins
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao listar logins',
      message: error.message
    });
  }
});

router.get('/logins/:id', requireAdmin, (req, res) => {
  try {
    const login = getLogin(req.params.id);
    
    if (!login) {
      return res.status(404).json({
        success: false,
        error: 'Login não encontrado'
      });
    }
    
    res.json({
      success: true,
      login: login
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao obter login',
      message: error.message
    });
  }
});

router.post('/logins', requireAdmin, (req, res) => {
  try {
    const { username, password, ambienteId, perfilId } = req.body;
    
    if (!username || !password || !ambienteId) {
      return res.status(400).json({
        success: false,
        error: 'Username, password e ambienteId são obrigatórios'
      });
    }
    
    // Normalizar perfilId: converter string vazia para null
    let perfilIdNormalizado = null;
    if (perfilId) {
      if (typeof perfilId === 'string' && perfilId.trim() !== '') {
        perfilIdNormalizado = perfilId.trim();
      } else if (typeof perfilId !== 'string') {
        perfilIdNormalizado = perfilId;
      }
    }
    
    const resultado = createLogin(username, password, ambienteId, perfilIdNormalizado);
    
    if (!resultado.success) {
      return res.status(400).json(resultado);
    }
    
    res.json({
      success: true,
      login: resultado.login
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao criar login',
      message: error.message
    });
  }
});

router.put('/logins/:id', requireAdmin, (req, res) => {
  try {
    const { username, password, ambienteId, perfilId, ativo } = req.body;
    
    const resultado = updateLogin(req.params.id, {
      username,
      password,
      ambienteId,
      perfilId,
      ativo
    });
    
    if (!resultado.success) {
      return res.status(400).json(resultado);
    }
    
    res.json({
      success: true,
      login: resultado.login
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao atualizar login',
      message: error.message
    });
  }
});

router.delete('/logins/:id', requireAdmin, (req, res) => {
  try {
    const resultado = deleteLogin(req.params.id);
    
    if (!resultado.success) {
      return res.status(400).json(resultado);
    }
    
    res.json({
      success: true,
      message: 'Login deletado com sucesso'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao deletar login',
      message: error.message
    });
  }
});

// Testar login
router.post('/logins/:id/testar', requireAdmin, (req, res) => {
  try {
    const { password } = req.body;
    const login = getLogin(req.params.id);
    
    if (!login) {
      return res.status(404).json({
        success: false,
        error: 'Login não encontrado'
      });
    }
    
    if (!login.ativo) {
      return res.status(400).json({
        success: false,
        error: 'Login está inativo'
      });
    }
    
    // Usar authenticateLogin para testar
    const { authenticateLogin } = require('../utils/database');
    const resultado = authenticateLogin(login.username, password);
    
    if (resultado.success) {
      res.json({
        success: true,
        message: 'Login testado com sucesso',
        login: {
          id: login.id,
          username: login.username,
          ambienteId: login.ambienteId,
          perfilId: login.perfilId,
          ativo: login.ativo
        },
        ambiente: resultado.ambiente,
        perfil: resultado.perfil
      });
    } else {
      res.status(400).json({
        success: false,
        error: resultado.error || 'Senha incorreta'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao testar login',
      message: error.message
    });
  }
});

// ============================================
// ROTAS CLT
// ============================================

// Armazenamento temporário de lotes em processamento
const lotesProcessamento = new Map();

// Consulta individual CLT - Endpoint unificado
router.post('/clt/simular-multiplos', requireAdmin, async (req, res) => {
  try {
    const { cpf, nome, telefone, dataNascimento, bancos } = req.body;
    
    // Validar campos obrigatórios
    if (!cpf || !telefone || !dataNascimento) {
      return res.status(400).json({
        success: false,
        error: 'CPF, telefone e data de nascimento são obrigatórios'
      });
    }
    
    if (!bancos || !Array.isArray(bancos) || bancos.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Selecione pelo menos um banco'
      });
    }
    
    // Obter ambiente do token/login
    const token = req.headers.authorization || req.query.token || req.body.token;
    let ambienteId = null;
    let porta = 4000; // Porta padrão para admin (rota-4000.teste)
    
    if (token && token.startsWith('login-token-')) {
      const partes = token.replace('login-token-', '').split('-');
      const loginId = partes.slice(0, -1).join('-');
      const login = getLogin(loginId);
      if (login) {
        ambienteId = login.ambienteId;
        const ambiente = getAmbiente(login.ambienteId);
        if (ambiente) {
          porta = ambiente.porta;
          ambienteId = ambiente.id; // Usar ID do ambiente para obter credenciais
        }
      }
    }
    
    // Se não tiver ambiente do login (admin), buscar ambiente 4000
    if (!ambienteId) {
      // Admin usa porta 4000 (rota-4000.teste)
      porta = 4000;
      // Buscar ambiente com porta 4000 para obter ambienteId
      const ambientes = listAmbientes();
      const ambiente4000 = ambientes.find(a => a.porta === 4000);
      if (ambiente4000) {
        ambienteId = ambiente4000.id;
      } else {
        // Se não encontrar ambiente cadastrado, criar um ambienteId temporário baseado na porta
        // Isso permite que o sistema funcione mesmo sem ambiente cadastrado
        ambienteId = `temp-${porta}`;
      }
    }
    
    // Importar proxy
    const { simularMultiplosBancos } = require('../utils/clt-proxy');
    
    // Executar simulações usando proxy com credenciais do ambiente
    const resultados = await simularMultiplosBancos(cpf, telefone, dataNascimento, bancos, porta, ambienteId, nome || '');
    
    // Formatar resultados para compatibilidade com frontend
    const resultadosFormatados = {};
    Object.keys(resultados).forEach(bancoId => {
      const resultado = resultados[bancoId];
      if (resultado.success && resultado.data) {
        // O resultado.data já vem do banco, pode ter estrutura diferente
        // Garantir que está no formato esperado pelo frontend
        resultadosFormatados[bancoId] = {
          success: true,
          banco: bancoId.toUpperCase(),
          dados: resultado.data
        };
      } else {
        resultadosFormatados[bancoId] = {
          success: false,
          banco: bancoId.toUpperCase(),
          error: resultado.error || 'Erro desconhecido',
          status: resultado.status
        };
      }
    });
    
    res.json({
      success: true,
      resultados: resultadosFormatados
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao processar consulta CLT',
      message: error.message
    });
  }
});

// Manter endpoint antigo para compatibilidade (usa mesma lógica)
router.post('/clt/consulta', requireAdmin, async (req, res) => {
  // Reutilizar a mesma lógica do endpoint novo
  const { cpf, nome, telefone, dataNascimento, bancos } = req.body;
  
  // Validar campos obrigatórios
  if (!cpf || !telefone || !dataNascimento) {
    return res.status(400).json({
      success: false,
      error: 'CPF, telefone e data de nascimento são obrigatórios'
    });
  }
  
  if (!bancos || !Array.isArray(bancos) || bancos.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Selecione pelo menos um banco'
    });
  }
  
  // Obter ambiente do token/login
  const token = req.headers.authorization || req.query.token || req.body.token;
  let ambienteId = null;
  let porta = 4000;
  
  if (token && token.startsWith('login-token-')) {
    const partes = token.replace('login-token-', '').split('-');
    const loginId = partes.slice(0, -1).join('-');
    const login = getLogin(loginId);
    if (login) {
      ambienteId = login.ambienteId;
      const ambiente = getAmbiente(login.ambienteId);
      if (ambiente) {
        porta = ambiente.porta;
        ambienteId = ambiente.id;
      }
    }
  }
  
  if (!ambienteId) {
    porta = 4000;
    const ambientes = listAmbientes();
    const ambiente4000 = ambientes.find(a => a.porta === 4000);
    if (ambiente4000) {
      ambienteId = ambiente4000.id;
    } else {
      ambienteId = `temp-${porta}`;
    }
  }
  
  const { simularMultiplosBancos } = require('../utils/clt-proxy');
  const resultados = await simularMultiplosBancos(cpf, telefone, dataNascimento, bancos, porta, ambienteId, nome || '');
  
  const resultadosFormatados = {};
  Object.keys(resultados).forEach(bancoId => {
    const resultado = resultados[bancoId];
    if (resultado.success) {
      resultadosFormatados[bancoId] = {
        success: true,
        banco: resultado.data?.banco || bancoId.toUpperCase(),
        dados: resultado.data
      };
    } else {
      resultadosFormatados[bancoId] = {
        success: false,
        banco: bancoId.toUpperCase(),
        error: resultado.error || 'Erro desconhecido',
        status: resultado.status
      };
    }
  });
  
  res.json({
    success: true,
    resultados: resultadosFormatados
  });
});

// Processamento em lote CLT
router.post('/clt/lote', requireAdmin, async (req, res) => {
  try {
    const { dados, bancos } = req.body;
    
    if (!dados || !Array.isArray(dados) || dados.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Dados do lote são obrigatórios'
      });
    }
    
    if (!bancos || !Array.isArray(bancos) || bancos.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Selecione pelo menos um banco'
      });
    }
    
    // Obter ambiente do token/login
    const token = req.headers.authorization || req.query.token || req.body.token;
    let ambienteId = null;
    let porta = 4000; // Porta padrão para admin (rota-4000.teste)
    
    if (token && token.startsWith('login-token-')) {
      const partes = token.replace('login-token-', '').split('-');
      const loginId = partes.slice(0, -1).join('-');
      const login = getLogin(loginId);
      if (login) {
        ambienteId = login.ambienteId;
        const ambiente = getAmbiente(login.ambienteId);
        if (ambiente) {
          porta = ambiente.porta;
        }
      }
    }
    
    // Se não tiver ambiente do login (admin), buscar ambiente 4000
    if (!ambienteId) {
      porta = 4000;
      const ambientes = listAmbientes();
      const ambiente4000 = ambientes.find(a => a.porta === 4000);
      if (ambiente4000) {
        ambienteId = ambiente4000.id;
      } else {
        ambienteId = `temp-${porta}`;
      }
    } else {
      // Garantir que temos o ambienteId correto
      const ambiente = getAmbiente(ambienteId);
      if (ambiente) {
        porta = ambiente.porta;
        ambienteId = ambiente.id;
      }
    }
    
    // Criar lote
    const loteId = `lote-${Date.now()}`;
    const lote = {
      id: loteId,
      dados: dados,
      bancos: bancos,
      porta: porta,
      ambienteId: ambienteId, // Adicionar ambienteId para obter credenciais
      status: 'processando',
      progresso: {
        total: dados.length,
        processados: 0,
        sucesso: 0,
        erro: 0
      },
      resultados: [],
      criadoEm: new Date().toISOString()
    };
    
    lotesProcessamento.set(loteId, lote);
    
    // Iniciar processamento em background
    processarLote(loteId).catch(err => {
      console.error('Erro ao processar lote:', err);
    });
    
    res.json({
      success: true,
      loteId: loteId,
      message: 'Lote criado e processamento iniciado'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao criar lote',
      message: error.message
    });
  }
});

// Status do lote
router.get('/clt/lote/:id/status', requireAdmin, (req, res) => {
  try {
    const lote = lotesProcessamento.get(req.params.id);
    
    if (!lote) {
      return res.status(404).json({
        success: false,
        error: 'Lote não encontrado'
      });
    }
    
    res.json({
      success: true,
      lote: lote
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao obter status do lote',
      message: error.message
    });
  }
});

/**
 * Processar lote em background
 */
async function processarLote(loteId) {
  const lote = lotesProcessamento.get(loteId);
  if (!lote) return;
  
  const { simularMultiplosBancos } = require('../utils/clt-proxy');
  const LIMITE_SIMULTANEOS = 10;
  
  // Processar em lotes de 10 simultâneos
  for (let i = 0; i < lote.dados.length; i += LIMITE_SIMULTANEOS) {
    const loteAtual = lote.dados.slice(i, i + LIMITE_SIMULTANEOS);
    
    // Processar simultaneamente até LIMITE_SIMULTANEOS
    const promessas = loteAtual.map(async (item) => {
      try {
        const cpf = item.cpf.replace(/\D/g, '');
        const telefone = item.telefone.replace(/\D/g, '');
        const dataNascimento = item.dataNascimento;
        
        const resultados = await simularMultiplosBancos(
          cpf,
          telefone,
          dataNascimento,
          lote.bancos,
          lote.porta,
          lote.ambienteId // Usar ambienteId para obter credenciais
        );
        
        // Formatar resultados
        const resultadosFormatados = {};
        Object.keys(resultados).forEach(bancoId => {
          const resultado = resultados[bancoId];
          resultadosFormatados[bancoId] = {
            success: resultado.success,
            dados: resultado.success ? resultado.data : null,
            error: resultado.success ? null : resultado.error
          };
        });
        
        // Atualizar progresso
        lote.progresso.processados++;
        const temSucesso = Object.values(resultadosFormatados).some(r => r.success);
        if (temSucesso) {
          lote.progresso.sucesso++;
        } else {
          lote.progresso.erro++;
        }
        
        lote.resultados.push({
          cpf: cpf,
          sucesso: temSucesso,
          resultados: resultadosFormatados,
          erro: temSucesso ? null : 'Todos os bancos falharam'
        });
      } catch (error) {
        // Atualizar progresso
        lote.progresso.processados++;
        lote.progresso.erro++;
        
        lote.resultados.push({
          cpf: item.cpf.replace(/\D/g, ''),
          sucesso: false,
          erro: error.message
        });
      }
      
      // Atualizar lote no Map
      lotesProcessamento.set(loteId, lote);
    });
    
    // Aguardar todas as promessas do lote atual antes de continuar
    await Promise.all(promessas);
  }
  
  // Marcar como concluído
  lote.status = 'concluido';
  lote.concluidoEm = new Date().toISOString();
  lotesProcessamento.set(loteId, lote);
}

module.exports = router;