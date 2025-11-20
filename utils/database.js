/**
 * Sistema de Armazenamento de Dados
 * Gerencia ambientes, usuários, permissões e configurações
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');

// Inicializar diretório de dados
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Estrutura inicial do banco de dados
 */
const DB_SCHEMA = {
  version: '1.0.0',
  admin: {
    usuarios: [
      {
        id: 'admin-1',
        username: 'admin',
        passwordHash: hashPassword('admin123'), // Senha padrão: admin123
        role: 'admin',
        criadoEm: new Date().toISOString()
      }
    ]
  },
  perfis: [], // Perfis de permissões (define o que pode fazer)
  logins: [], // Logins de acesso (define qual ambiente acessa)
  ambientes: [],
  bancosDisponiveis: [
    {
      id: 'presencabank',
      nome: 'Presença Bank',
      descricao: 'Sistema Presença Bank',
      ativo: true
    },
    {
      id: 'v8',
      nome: 'V8 Digital',
      descricao: 'Sistema V8 Digital CLT',
      ativo: true
    },
    {
      id: 'hubcredito',
      nome: 'HubCredito',
      descricao: 'Sistema HubCredito CLT',
      ativo: true
    }
  ],
  ultimaSincronizacao: null
};

/**
 * Hash de senha
 */
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

/**
 * Verificar senha
 */
function verifyPassword(password, hash) {
  return hashPassword(password) === hash;
}

/**
 * Carregar banco de dados
 */
function loadDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      const db = JSON.parse(data);
      
      // Garantir que perfis e logins existem (migração)
      if (!db.perfis) {
        db.perfis = [];
      }
      if (!db.logins) {
        db.logins = [];
      }
      
      return db;
    } else {
      // Criar banco inicial
      saveDatabase(DB_SCHEMA);
      return DB_SCHEMA;
    }
  } catch (error) {
    console.error('❌ Erro ao carregar banco de dados:', error);
    return DB_SCHEMA;
  }
}

/**
 * Salvar banco de dados
 */
function saveDatabase(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('❌ Erro ao salvar banco de dados:', error);
    return false;
  }
}

/**
 * Obter banco de dados
 */
function getDatabase() {
  return loadDatabase();
}

/**
 * Atualizar banco de dados
 */
function updateDatabase(updater) {
  const db = loadDatabase();
  const updated = updater(db);
  saveDatabase(updated);
  return updated;
}

/**
 * Autenticar usuário admin
 */
function authenticateAdmin(username, password) {
  const db = loadDatabase();
  const usuario = db.admin.usuarios.find(u => u.username === username);
  
  if (!usuario) {
    return { success: false, error: 'Usuário não encontrado' };
  }
  
  if (!verifyPassword(password, usuario.passwordHash)) {
    return { success: false, error: 'Senha incorreta' };
  }
  
  return {
    success: true,
    usuario: {
      id: usuario.id,
      username: usuario.username,
      role: usuario.role
    }
  };
}

/**
 * Criar novo ambiente
 */
function createAmbiente(nome, porta, username, password, bancosPermitidos = [], pipelineKentro = null) {
  // Pipeline sempre será null ao criar (será configurado depois no sistema)
  pipelineKentro = null;
  const db = loadDatabase();
  
  // Verificar se porta já existe
  const ambienteExistente = db.ambientes.find(a => a.porta === porta);
  if (ambienteExistente) {
    return { success: false, error: `Porta ${porta} já está em uso` };
  }
  
  // Verificar se nome já existe
  const nomeExistente = db.ambientes.find(a => a.nome === nome);
  if (nomeExistente) {
    return { success: false, error: `Ambiente "${nome}" já existe` };
  }
  
  const novoAmbiente = {
    id: `ambiente-${Date.now()}`,
    nome: nome,
    porta: porta,
    path: `rota-${porta}.producao`,
    username: username,
    passwordHash: hashPassword(password),
    bancosPermitidos: bancosPermitidos,
    pipelineKentro: null, // Sempre criar sem pipeline (será configurado depois)
    criadoEm: new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
    ativo: true
  };
  
  db.ambientes.push(novoAmbiente);
  saveDatabase(db);
  
  return {
    success: true,
    ambiente: {
      id: novoAmbiente.id,
      nome: novoAmbiente.nome,
      porta: novoAmbiente.porta,
      path: novoAmbiente.path,
      bancosPermitidos: novoAmbiente.bancosPermitidos
    }
  };
}

/**
 * Listar ambientes
 */
function listAmbientes() {
  const db = loadDatabase();
  return db.ambientes.map(a => ({
    id: a.id,
    nome: a.nome,
    porta: a.porta,
    path: a.path,
    bancosPermitidos: a.bancosPermitidos,
    pipelineKentro: a.pipelineKentro || null,
    ativo: a.ativo,
    criadoEm: a.criadoEm,
    atualizadoEm: a.atualizadoEm
  }));
}

/**
 * Obter ambiente por ID
 */
function getAmbiente(ambienteId) {
  const db = loadDatabase();
  return db.ambientes.find(a => a.id === ambienteId);
}

/**
 * Atualizar permissões de bancos de um ambiente
 */
function updateBancosPermitidos(ambienteId, bancosPermitidos) {
  const db = loadDatabase();
  const ambiente = db.ambientes.find(a => a.id === ambienteId);
  
  if (!ambiente) {
    return { success: false, error: 'Ambiente não encontrado' };
  }
  
  ambiente.bancosPermitidos = bancosPermitidos;
  ambiente.atualizadoEm = new Date().toISOString();
  
  const saved = saveDatabase(db);
  if (!saved) {
    return { success: false, error: 'Erro ao salvar banco de dados', errorCode: 'DB_SAVE_ERROR' };
  }
  
  return { success: true, ambiente };
}

/**
 * Atualizar ambiente (nome, pipeline, etc)
 */
function updateAmbiente(ambienteId, dados) {
  const db = loadDatabase();
  const ambiente = db.ambientes.find(a => a.id === ambienteId);
  
  if (!ambiente) {
    return { success: false, error: 'Ambiente não encontrado' };
  }
  
  if (dados.nome !== undefined) {
    const nomeExistente = db.ambientes.find(a => a.nome === dados.nome && a.id !== ambienteId);
    if (nomeExistente) {
      return { success: false, error: `Ambiente "${dados.nome}" já existe` };
    }
    ambiente.nome = dados.nome;
  }
  
  if (dados.pipelineKentro !== undefined) {
    ambiente.pipelineKentro = dados.pipelineKentro || null;
  }
  
  if (dados.ativo !== undefined) {
    ambiente.ativo = dados.ativo;
  }
  
  ambiente.atualizadoEm = new Date().toISOString();
  saveDatabase(db);
  
  return { success: true, ambiente };
}

/**
 * Autenticar ambiente
 */
function authenticateAmbiente(ambienteId, username, password) {
  const ambiente = getAmbiente(ambienteId);
  
  if (!ambiente) {
    return { success: false, error: 'Ambiente não encontrado' };
  }
  
  if (ambiente.username !== username) {
    return { success: false, error: 'Usuário incorreto' };
  }
  
  if (!verifyPassword(password, ambiente.passwordHash)) {
    return { success: false, error: 'Senha incorreta' };
  }
  
  return {
    success: true,
    ambiente: {
      id: ambiente.id,
      nome: ambiente.nome,
      porta: ambiente.porta,
      bancosPermitidos: ambiente.bancosPermitidos
    }
  };
}

/**
 * Obter bancos disponíveis
 */
function getBancosDisponiveis() {
  const db = loadDatabase();
  return db.bancosDisponiveis.filter(b => b.ativo);
}

/**
 * Atualizar lista de bancos disponíveis (sincronizar da rota-4000)
 */
function updateBancosDisponiveis(bancos) {
  const db = loadDatabase();
  db.bancosDisponiveis = bancos;
  db.ultimaSincronizacao = new Date().toISOString();
  saveDatabase(db);
  return { success: true };
}

/**
 * Deletar ambiente
 */
function deleteAmbiente(ambienteId) {
  const db = loadDatabase();
  const index = db.ambientes.findIndex(a => a.id === ambienteId);
  
  if (index === -1) {
    return { success: false, error: 'Ambiente não encontrado' };
  }
  
  const ambiente = db.ambientes[index];
  const ambientePath = path.join(__dirname, '..', '..', ambiente.path);
  
  // Remover do banco de dados primeiro
  db.ambientes.splice(index, 1);
  const saved = saveDatabase(db);
  
  if (!saved) {
    return { success: false, error: 'Erro ao salvar banco de dados após deletar ambiente' };
  }
  
  // Tentar deletar a pasta física
  try {
    if (fs.existsSync(ambientePath)) {
      // Função recursiva para deletar pasta
      function deletarPastaRecursiva(caminho) {
        if (fs.existsSync(caminho)) {
          const stats = fs.statSync(caminho);
          if (stats.isDirectory()) {
            const arquivos = fs.readdirSync(caminho);
            arquivos.forEach(arquivo => {
              const caminhoCompleto = path.join(caminho, arquivo);
              deletarPastaRecursiva(caminhoCompleto);
            });
            fs.rmdirSync(caminho);
          } else {
            fs.unlinkSync(caminho);
          }
        }
      }
      
      deletarPastaRecursiva(ambientePath);
      return { success: true, message: 'Ambiente e pasta deletados com sucesso' };
    } else {
      return { success: true, message: 'Ambiente deletado (pasta não encontrada)' };
    }
  } catch (error) {
    console.error(`Erro ao deletar pasta do ambiente ${ambienteId}:`, error.message);
    // Retornar sucesso mesmo se não conseguir deletar a pasta (ambiente já foi removido do BD)
    return { 
      success: true, 
      message: 'Ambiente deletado do banco de dados, mas houve erro ao deletar a pasta física',
      warning: error.message
    };
  }
}

/**
 * Sincronizar ambientes existentes no sistema de arquivos com o banco de dados
 * Detecta pastas rota-*.producao e registra/atualiza no banco
 */
function sincronizarAmbientesExistentes() {
  const { detectarAmbientesExistentes } = require('./ambiente-manager');
  const ambientesDetectados = detectarAmbientesExistentes();
  const db = loadDatabase();
  
  const resultados = {
    criados: [],
    atualizados: [],
    existentes: []
  };
  
  ambientesDetectados.forEach(ambienteDetectado => {
    // Ignorar porta 7000 (sistema-admin)
    if (ambienteDetectado.porta === 7000) {
      return;
    }
    
    // Verificar se ambiente já existe no banco (por porta)
    const ambienteExistente = db.ambientes.find(a => a.porta === ambienteDetectado.porta);
    
    if (ambienteExistente) {
      // Atualizar informações do ambiente existente
      // IMPORTANTE: Não sobrescrever bancosPermitidos se já foram definidos manualmente
      // Apenas atualizar se o ambiente não tinha bancos definidos (array vazio)
      const mudou = ambienteExistente.path !== ambienteDetectado.path;
      
      ambienteExistente.path = ambienteDetectado.path;
      
      // Só atualizar bancosPermitidos se estiver vazio (não foi definido manualmente)
      // ou se os bancos detectados são diferentes E o ambiente não tinha bancos definidos
      if (!ambienteExistente.bancosPermitidos || ambienteExistente.bancosPermitidos.length === 0) {
        ambienteExistente.bancosPermitidos = ambienteDetectado.bancosPermitidos;
      }
      // Caso contrário, manter os bancos permitidos que foram definidos manualmente
      
      ambienteExistente.atualizadoEm = new Date().toISOString();
      ambienteExistente.ativo = true;
      
      if (mudou) {
        resultados.atualizados.push({
          id: ambienteExistente.id,
          nome: ambienteExistente.nome,
          porta: ambienteExistente.porta
        });
      } else {
        resultados.existentes.push({
          id: ambienteExistente.id,
          nome: ambienteExistente.nome,
          porta: ambienteExistente.porta,
          status: 'já registrado'
        });
      }
    } else {
      // Criar novo ambiente no banco
      const novoAmbiente = {
        id: `ambiente-${Date.now()}-${ambienteDetectado.porta}`,
        nome: ambienteDetectado.nome,
        porta: ambienteDetectado.porta,
        path: ambienteDetectado.path,
        username: `admin-${ambienteDetectado.porta}`, // Username padrão
        passwordHash: hashPassword(`admin${ambienteDetectado.porta}`), // Senha padrão: admin{porta}
        bancosPermitidos: ambienteDetectado.bancosPermitidos,
        criadoEm: new Date().toISOString(),
        atualizadoEm: new Date().toISOString(),
        ativo: true
      };
      
      db.ambientes.push(novoAmbiente);
      
      resultados.criados.push({
        id: novoAmbiente.id,
        nome: novoAmbiente.nome,
        porta: novoAmbiente.porta,
        username: novoAmbiente.username,
        password: `admin${ambienteDetectado.porta}` // Retornar senha padrão
      });
    }
  });
  
  // Marcar ambientes que não existem mais no sistema de arquivos como inativos
  db.ambientes.forEach(ambiente => {
    const existeNoSistema = ambientesDetectados.find(a => a.porta === ambiente.porta);
    if (!existeNoSistema && ambiente.porta !== 4000) { // Não marcar rota-4000 como inativo
      ambiente.ativo = false;
      resultados.existentes.push({
        id: ambiente.id,
        nome: ambiente.nome,
        porta: ambiente.porta,
        status: 'marcado como inativo (pasta não encontrada)'
      });
    }
  });
  
  saveDatabase(db);
  
  return {
    success: true,
    totalDetectados: ambientesDetectados.length,
    resultados: resultados
  };
}

/**
 * ============================================
 * FUNÇÕES DE PERFIS DE LOGIN
 * ============================================
 */

/**
 * Listar todos os perfis
 */
function listPerfis() {
  const db = loadDatabase();
  return db.perfis || [];
}

/**
 * Obter perfil por ID
 */
function getPerfil(perfilId) {
  const db = loadDatabase();
  return db.perfis.find(p => p.id === perfilId);
}

/**
 * Criar novo perfil
 */
function createPerfil(nome, permissoes = {}) {
  const db = loadDatabase();
  
  // Verificar se nome já existe
  const perfilExistente = db.perfis.find(p => p.nome === nome);
  if (perfilExistente) {
    return { success: false, error: `Perfil "${nome}" já existe` };
  }
  
  const novoPerfil = {
    id: `perfil-${Date.now()}`,
    nome: nome,
    permissoes: {
      // Bancos
      bancos_testarAPIs: permissoes.bancos_testarAPIs || false,
      bancos_gerenciarCredenciais: permissoes.bancos_gerenciarCredenciais || false,
      
      // Ambientes
      ambientes_visualizar: permissoes.ambientes_visualizar || false,
      ambientes_sincronizar: permissoes.ambientes_sincronizar || false,
      ambientes_reiniciar: permissoes.ambientes_reiniciar || false,
      
      // Gerenciar Ambientes
      gerenciarAmbientes: permissoes.gerenciarAmbientes || false,
      gerenciarAmbientes_definirBancos: permissoes.gerenciarAmbientes_definirBancos || false,
      gerenciarAmbientes_nomearAmbiente: permissoes.gerenciarAmbientes_nomearAmbiente || false,
      
      // Outros
      criarPerfis: permissoes.criarPerfis || false,
      
      // CLT
      clt_consulta: permissoes.clt_consulta || false,
      clt_lote: permissoes.clt_lote || false
    },
    criadoEm: new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
    ativo: true
  };
  
  if (!db.perfis) {
    db.perfis = [];
  }
  
  db.perfis.push(novoPerfil);
  saveDatabase(db);
  
  return {
    success: true,
    perfil: novoPerfil
  };
}

/**
 * Atualizar perfil
 */
function updatePerfil(perfilId, dados) {
  const db = loadDatabase();
  const perfil = db.perfis.find(p => p.id === perfilId);
  
  if (!perfil) {
    return { success: false, error: 'Perfil não encontrado' };
  }
  
  // Atualizar campos permitidos
  if (dados.nome !== undefined) {
    // Verificar se novo nome já existe (exceto o próprio perfil)
    const nomeExistente = db.perfis.find(p => p.nome === dados.nome && p.id !== perfilId);
    if (nomeExistente) {
      return { success: false, error: `Perfil "${dados.nome}" já existe` };
    }
    perfil.nome = dados.nome;
  }
  
  if (dados.permissoes !== undefined) {
    perfil.permissoes = { ...perfil.permissoes, ...dados.permissoes };
  }
  
  if (dados.ativo !== undefined) {
    perfil.ativo = dados.ativo;
  }
  
  perfil.atualizadoEm = new Date().toISOString();
  saveDatabase(db);
  
  return {
    success: true,
    perfil: perfil
  };
}

/**
 * Deletar perfil
 */
function deletePerfil(perfilId) {
  const db = loadDatabase();
  const index = db.perfis.findIndex(p => p.id === perfilId);
  
  if (index === -1) {
    return { success: false, error: 'Perfil não encontrado' };
  }
  
  db.perfis.splice(index, 1);
  saveDatabase(db);
  
  return { success: true };
}

/**
 * Autenticar com perfil
 */
function authenticatePerfil(perfilId, username, password) {
  // Por enquanto, perfis usam autenticação de ambiente
  // Futuramente pode ter autenticação própria
  const perfil = getPerfil(perfilId);
  
  if (!perfil || !perfil.ativo) {
    return { success: false, error: 'Perfil não encontrado ou inativo' };
  }
  
  // Verificar se o ambiente está nos permitidos
  // Isso será verificado no middleware de autenticação
  
  return {
    success: true,
    perfil: perfil
  };
}

/**
 * Listar todos os logins
 */
function listLogins() {
  const db = loadDatabase();
  return db.logins || [];
}

/**
 * Obter login por ID
 */
function getLogin(loginId) {
  const db = loadDatabase();
  return db.logins.find(l => l.id === loginId);
}

/**
 * Criar novo login
 */
function createLogin(username, password, ambienteId, perfilId = null) {
  const db = loadDatabase();
  
  // Normalizar username (trim e manter case original para exibição)
  const usernameNormalizado = username ? username.trim() : '';
  if (!usernameNormalizado) {
    return { success: false, error: 'Username não pode ser vazio' };
  }
  
  // Normalizar perfilId: converter string vazia ou undefined para null
  let perfilIdNormalizado = null;
  if (perfilId) {
    if (typeof perfilId === 'string' && perfilId.trim() !== '') {
      perfilIdNormalizado = perfilId.trim();
    } else if (typeof perfilId !== 'string' && perfilId) {
      perfilIdNormalizado = perfilId;
    }
  }
  
  // Verificar se username já existe (case-insensitive)
  const loginExistente = db.logins.find(l => l.username && l.username.toLowerCase() === usernameNormalizado.toLowerCase());
  if (loginExistente) {
    return { success: false, error: `Login "${username}" já existe` };
  }
  
  // Verificar se ambiente existe
  const ambiente = db.ambientes.find(a => a.id === ambienteId);
  if (!ambiente) {
    return { success: false, error: 'Ambiente não encontrado' };
  }
  
  // Verificar se perfil existe (se fornecido)
  if (perfilIdNormalizado) {
    const perfil = db.perfis.find(p => p.id === perfilIdNormalizado);
    if (!perfil) {
      return { success: false, error: 'Perfil não encontrado' };
    }
  }
  
  const novoLogin = {
    id: `login-${Date.now()}`,
    username: usernameNormalizado, // Usar username normalizado
    passwordHash: hashPassword(password),
    ambienteId: ambienteId,
    perfilId: perfilIdNormalizado,
    criadoEm: new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
    ativo: true
  };
  
  if (!db.logins) {
    db.logins = [];
  }
  
  db.logins.push(novoLogin);
  const saved = saveDatabase(db);
  
  if (!saved) {
    return { success: false, error: 'Erro ao salvar login no banco de dados' };
  }
  
  return {
    success: true,
    login: novoLogin
  };
}

/**
 * Atualizar login
 */
function updateLogin(loginId, dados) {
  const db = loadDatabase();
  const login = db.logins.find(l => l.id === loginId);
  
  if (!login) {
    return { success: false, error: 'Login não encontrado' };
  }
  
  if (dados.username !== undefined) {
    const usernameNormalizado = dados.username ? dados.username.trim() : '';
    if (!usernameNormalizado) {
      return { success: false, error: 'Username não pode ser vazio' };
    }
    // Verificar se username já existe (case-insensitive, exceto o próprio login)
    const usernameExistente = db.logins.find(l => 
      l.id !== loginId && 
      l.username && 
      l.username.toLowerCase() === usernameNormalizado.toLowerCase()
    );
    if (usernameExistente) {
      return { success: false, error: `Login "${usernameNormalizado}" já existe` };
    }
    login.username = usernameNormalizado;
  }
  
  if (dados.password !== undefined) {
    login.passwordHash = hashPassword(dados.password);
  }
  
  if (dados.ambienteId !== undefined) {
    const ambiente = db.ambientes.find(a => a.id === dados.ambienteId);
    if (!ambiente) {
      return { success: false, error: 'Ambiente não encontrado' };
    }
    login.ambienteId = dados.ambienteId;
  }
  
  if (dados.perfilId !== undefined) {
    if (dados.perfilId) {
      const perfil = db.perfis.find(p => p.id === dados.perfilId);
      if (!perfil) {
        return { success: false, error: 'Perfil não encontrado' };
      }
    }
    login.perfilId = dados.perfilId;
  }
  
  if (dados.ativo !== undefined) {
    login.ativo = dados.ativo;
  }
  
  login.atualizadoEm = new Date().toISOString();
  saveDatabase(db);
  
  return {
    success: true,
    login: login
  };
}

/**
 * Deletar login
 */
function deleteLogin(loginId) {
  const db = loadDatabase();
  const index = db.logins.findIndex(l => l.id === loginId);
  
  if (index === -1) {
    return { success: false, error: 'Login não encontrado' };
  }
  
  db.logins.splice(index, 1);
  saveDatabase(db);
  
  return { success: true };
}

/**
 * Autenticar com login
 */
function authenticateLogin(username, password) {
  const db = loadDatabase();
  
  // Normalizar username para busca case-insensitive
  const usernameNormalizado = username ? username.trim().toLowerCase() : '';
  
  // Primeiro, buscar login pelo username (sem verificar ativo ainda) - case-insensitive
  const login = db.logins.find(l => l.username && l.username.toLowerCase() === usernameNormalizado);
  
  if (!login) {
    return { success: false, error: 'Usuário não encontrado', errorCode: 'USER_NOT_FOUND' };
  }
  
  // Verificar se está ativo
  if (!login.ativo) {
    return { success: false, error: 'Usuário inativo', errorCode: 'USER_INACTIVE' };
  }
  
  // Verificar senha
  if (!verifyPassword(password, login.passwordHash)) {
    return { success: false, error: 'Senha incorreta', errorCode: 'INVALID_PASSWORD' };
  }
  
  // Buscar perfil associado
  let perfil = null;
  if (login.perfilId) {
    perfil = db.perfis.find(p => p.id === login.perfilId);
    if (perfil && !perfil.ativo) {
      return { success: false, error: 'Perfil associado está inativo', errorCode: 'PERFIL_INACTIVE' };
    }
  }
  
  // Buscar ambiente
  const ambiente = db.ambientes.find(a => a.id === login.ambienteId);
  if (!ambiente) {
    return { success: false, error: 'Ambiente associado não encontrado', errorCode: 'AMBIENTE_NOT_FOUND' };
  }
  
  if (!ambiente.ativo) {
    return { success: false, error: 'Ambiente associado está inativo', errorCode: 'AMBIENTE_INACTIVE' };
  }
  
  return {
    success: true,
    login: login,
    perfil: perfil,
    ambiente: ambiente
  };
}

module.exports = {
  getDatabase,
  updateDatabase,
  authenticateAdmin,
  createAmbiente,
  listAmbientes,
  getAmbiente,
  updateBancosPermitidos,
  updateAmbiente,
  authenticateAmbiente,
  getBancosDisponiveis,
  updateBancosDisponiveis,
  deleteAmbiente,
  sincronizarAmbientesExistentes,
  hashPassword,
  verifyPassword,
  // Perfis
  listPerfis,
  getPerfil,
  createPerfil,
  updatePerfil,
  deletePerfil,
  authenticatePerfil,
  // Logins
  listLogins,
  getLogin,
  createLogin,
  updateLogin,
  deleteLogin,
  authenticateLogin
};