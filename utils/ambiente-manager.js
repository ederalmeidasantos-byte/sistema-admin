/**
 * Gerenciador de Ambientes
 * Cria, atualiza e sincroniza ambientes
 */

const fs = require('fs');
const path = require('path');
const { getAmbiente } = require('./database');

const BASE_PATH = '/opt/lunas-digital';
const AMBIENTE_TESTE = path.join(BASE_PATH, 'rota-4000.teste');

/**
 * Detectar ambientes existentes nas pastas rota-*.producao
 */
function detectarAmbientesExistentes() {
  const ambientes = [];
  
  try {
    // Listar todas as pastas rota-*.producao
    const items = fs.readdirSync(BASE_PATH);
    
    items.forEach(item => {
      // Verificar se é uma pasta rota-*.producao (excluir sistema-admin)
      if (item.startsWith('rota-') && item.endsWith('.producao') && item !== 'rota-7000.producao') {
        const ambientePath = path.join(BASE_PATH, item);
        
        // Verificar se é um diretório
        try {
          if (fs.statSync(ambientePath).isDirectory()) {
            // Extrair porta do nome da pasta (ex: rota-5000.producao -> 5000)
            const match = item.match(/rota-(\d+)\.producao/);
            if (match) {
              const porta = parseInt(match[1]);
              
              // Ignorar porta 7000 (sistema-admin)
              if (porta === 7000) {
                return;
              }
              
              // Verificar se existe .env para obter mais informações
              const envPath = path.join(ambientePath, '.env');
              let nome = `Ambiente ${porta}`;
              let bancosPermitidos = [];
              
              // Tentar detectar bancos instalados
              const bancosPossiveis = ['presençabank', 'V8', 'hubcredito'];
              bancosPermitidos = bancosPossiveis.filter(banco => {
                return fs.existsSync(path.join(ambientePath, banco));
              });
              
              // Mapear nomes de pastas para IDs
              const mapeamentoBancos = {
                'presençabank': 'presencabank',
                'V8': 'v8',
                'hubcredito': 'hubcredito'
              };
              
              bancosPermitidos = bancosPermitidos.map(b => mapeamentoBancos[b] || b);
              
              ambientes.push({
                nome: nome,
                porta: porta,
                path: item,
                pathCompleto: ambientePath,
                bancosPermitidos: bancosPermitidos,
                existe: true,
                temEnv: fs.existsSync(envPath)
              });
            }
          }
        } catch (error) {
          // Ignorar erros ao acessar diretório
          console.error(`Erro ao processar ${item}:`, error.message);
        }
      }
    });
    
    // Ordenar por porta
    ambientes.sort((a, b) => a.porta - b.porta);
    
    return ambientes;
  } catch (error) {
    console.error('Erro ao detectar ambientes existentes:', error);
    return [];
  }
}

/**
 * Detectar bancos disponíveis na rota-4000
 */
function detectarBancosDisponiveis() {
  const bancos = [];
  
  // Verificar Presença Bank
  if (fs.existsSync(path.join(AMBIENTE_TESTE, 'presençabank'))) {
    bancos.push({
      id: 'presencabank',
      nome: 'Presença Bank',
      descricao: 'Sistema Presença Bank',
      ativo: true,
      path: 'presençabank'
    });
  }
  
  // Verificar V8
  if (fs.existsSync(path.join(AMBIENTE_TESTE, 'V8'))) {
    bancos.push({
      id: 'v8',
      nome: 'V8 Digital',
      descricao: 'Sistema V8 Digital CLT',
      ativo: true,
      path: 'V8'
    });
  }
  
  // Verificar HubCredito
  if (fs.existsSync(path.join(AMBIENTE_TESTE, 'hubcredito'))) {
    bancos.push({
      id: 'hubcredito',
      nome: 'HubCredito',
      descricao: 'Sistema HubCredito CLT',
      ativo: true,
      path: 'hubcredito'
    });
  }
  
  return bancos;
}

/**
 * Criar estrutura de ambiente
 */
function criarEstruturaAmbiente(porta, bancosPermitidos) {
  const ambientePath = path.join(BASE_PATH, `rota-${porta}.producao`);
  
  // Criar diretório base
  if (!fs.existsSync(ambientePath)) {
    fs.mkdirSync(ambientePath, { recursive: true });
  }
  
  // Criar .env base (sem credenciais, apenas porta)
  const envPath = path.join(ambientePath, '.env');
  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, `# Configuração do Ambiente ${porta}\nPORT=${porta}\n\n`);
  }
  
  // Copiar bancos permitidos
  bancosPermitidos.forEach(bancoId => {
    // Mapear ID do banco para nome da pasta
    const mapeamentoBancos = {
      'presencabank': 'presençabank',
      'v8': 'V8',
      'hubcredito': 'hubcredito'
    };
    const nomePastaBanco = mapeamentoBancos[bancoId] || bancoId;
    
    const bancoPath = path.join(AMBIENTE_TESTE, nomePastaBanco);
    const destinoPath = path.join(ambientePath, nomePastaBanco);
    
    if (fs.existsSync(bancoPath) && !fs.existsSync(destinoPath)) {
      copiarDiretorio(bancoPath, destinoPath, bancoId);
    }
  });
  
  // Copiar arquivos compartilhados
  const compartilhados = ['shared', 'cache-centralizado'];
  compartilhados.forEach(item => {
    const origem = path.join(AMBIENTE_TESTE, item);
    const destino = path.join(ambientePath, item);
    
    if (fs.existsSync(origem) && !fs.existsSync(destino)) {
      copiarDiretorio(origem, destino);
    }
  });
  
  return { success: true, path: ambientePath };
}

/**
 * Limpar config.env deixando apenas credenciais do banco correspondente
 */
function limparConfigEnvBanco(bancoPath, bancoId) {
  const configEnvPath = path.join(bancoPath, 'config', 'config.env');
  
  if (!fs.existsSync(configEnvPath)) {
    return; // Se não existe, não precisa limpar
  }
  
  // Mapear quais credenciais manter por banco
  const credenciaisPorBanco = {
    'presençabank': {
      manter: [
        'PRECENÇABANK_', 'PORT=', 'NODE_ENV=', 'LOG_', 'TESTE_',
        'V8_API_URL=', 'V8_AUTH_URL=', 'V8_CLIENT_ID=', 'V8_AUDIENCE=', // V8 pode ser usado pelo presençabank
        'KENTRO_', '#'
      ],
      remover: ['HUBCREDITO_', 'V8_USERNAME=', 'V8_PASSWORD=']
    },
    'V8': {
      manter: [
        'V8_', 'PORT=', 'NODE_ENV=', 'LOG_', 'HTTPS_PORT=',
        'KENTRO_', '#'
      ],
      remover: ['PRECENÇABANK_', 'HUBCREDITO_']
    },
    'hubcredito': {
      manter: [
        'HUBCREDITO_', 'PORT=', 'NODE_ENV=', 'LOG_', 'TESTE_',
        'V8_API_URL=', 'V8_AUTH_URL=', 'V8_CLIENT_ID=', 'V8_AUDIENCE=', // V8 pode ser usado pelo hubcredito
        'KENTRO_', '#'
      ],
      remover: ['PRECENÇABANK_', 'V8_USERNAME=', 'V8_PASSWORD=']
    }
  };
  
  // Mapear ID do banco para nome da pasta
  const mapeamentoBancos = {
    'presencabank': 'presençabank',
    'v8': 'V8',
    'hubcredito': 'hubcredito'
  };
  
  const nomePastaBanco = mapeamentoBancos[bancoId] || bancoId;
  const regras = credenciaisPorBanco[nomePastaBanco];
  
  if (!regras) {
    return; // Se não tem regras, manter como está
  }
  
  // Ler arquivo atual
  let envContent = fs.readFileSync(configEnvPath, 'utf8');
  const linhas = envContent.split('\n');
  const linhasFiltradas = [];
  
  linhas.forEach(linha => {
    const linhaTrim = linha.trim();
    
    // Manter linhas vazias e comentários
    if (linhaTrim === '' || linhaTrim.startsWith('#')) {
      linhasFiltradas.push(linha);
      return;
    }
    
    // Verificar se deve manter
    let manter = false;
    for (const prefixo of regras.manter) {
      if (linhaTrim.startsWith(prefixo)) {
        manter = true;
        break;
      }
    }
    
    // Verificar se deve remover
    if (manter) {
      for (const prefixo of regras.remover) {
        if (linhaTrim.startsWith(prefixo)) {
          manter = false;
          break;
        }
      }
    }
    
    if (manter) {
      linhasFiltradas.push(linha);
    }
  });
  
  // Escrever arquivo limpo
  fs.writeFileSync(configEnvPath, linhasFiltradas.join('\n'), 'utf8');
}

/**
 * Copiar diretório recursivamente
 */
function copiarDiretorio(origem, destino, bancoId = null) {
  if (!fs.existsSync(origem)) {
    return false;
  }
  
  try {
    // Criar diretório destino
    if (!fs.existsSync(destino)) {
      fs.mkdirSync(destino, { recursive: true });
    }
    
    // Listar arquivos e diretórios
    const items = fs.readdirSync(origem);
    
    items.forEach(item => {
      const origemPath = path.join(origem, item);
      const destinoPath = path.join(destino, item);
      const stat = fs.statSync(origemPath);
      
      // Ignorar node_modules, logs, .git
      if (item === 'node_modules' || item === 'logs' || item === '.git' || item.startsWith('.')) {
        return;
      }
      
      if (stat.isDirectory()) {
        copiarDiretorio(origemPath, destinoPath, bancoId);
      } else {
        fs.copyFileSync(origemPath, destinoPath);
      }
    });
    
    // Se é um banco e tem config.env, limpar após copiar
    if (bancoId) {
      limparConfigEnvBanco(destino, bancoId);
    }
    
    return true;
  } catch (error) {
    console.error(`Erro ao copiar diretório de ${origem} para ${destino}:`, error);
    throw error;
  }
}

/**
 * Sincronizar banco específico da rota-4000 para ambiente
 */
function sincronizarBanco(ambienteId, bancoId) {
  const ambiente = getAmbiente(ambienteId);
  if (!ambiente) {
    return { success: false, error: 'Ambiente não encontrado' };
  }
  
  if (!ambiente.bancosPermitidos.includes(bancoId)) {
    return { success: false, error: 'Banco não permitido para este ambiente' };
  }
  
  // Mapear ID do banco para nome da pasta
  const mapeamentoBancos = {
    'presencabank': 'presençabank',
    'v8': 'V8',
    'hubcredito': 'hubcredito'
  };
  
  const nomePastaBanco = mapeamentoBancos[bancoId] || bancoId;
  
  const ambientePath = path.join(BASE_PATH, ambiente.path);
  const bancoOrigem = path.join(AMBIENTE_TESTE, nomePastaBanco);
  const bancoDestino = path.join(ambientePath, nomePastaBanco);
  
  if (!fs.existsSync(bancoOrigem)) {
    return { success: false, error: `Banco ${bancoId} (pasta: ${nomePastaBanco}) não encontrado na rota-4000` };
  }
  
  // Copiar/atualizar banco (limpará config.env automaticamente)
  try {
    copiarDiretorio(bancoOrigem, bancoDestino, bancoId);
    return { success: true, message: `Banco ${bancoId} sincronizado com sucesso` };
  } catch (error) {
    return { success: false, error: `Erro ao copiar banco ${bancoId}: ${error.message}` };
  }
}

/**
 * Sincronizar todos os bancos permitidos de um ambiente
 */
function sincronizarAmbiente(ambienteId) {
  const ambiente = getAmbiente(ambienteId);
  if (!ambiente) {
    return { success: false, error: 'Ambiente não encontrado' };
  }
  
  const resultados = [];
  
  ambiente.bancosPermitidos.forEach(bancoId => {
    const resultado = sincronizarBanco(ambienteId, bancoId);
    resultados.push({ banco: bancoId, ...resultado });
  });
  
  // Sincronizar arquivos compartilhados também
  const compartilhados = ['shared', 'cache-centralizado'];
  compartilhados.forEach(item => {
    const origem = path.join(AMBIENTE_TESTE, item);
    const destino = path.join(BASE_PATH, ambiente.path, item);
    
    if (fs.existsSync(origem)) {
      copiarDiretorio(origem, destino);
      resultados.push({ item: item, success: true });
    }
  });
  
  return { success: true, resultados };
}

/**
 * Sincronizar todos os ambientes da rota-4000
 */
function sincronizarTodosAmbientes() {
  const { listAmbientes } = require('./database');
  const ambientes = listAmbientes();
  const resultados = [];
  
  ambientes.forEach(ambiente => {
    if (ambiente.ativo) {
      const resultado = sincronizarAmbiente(ambiente.id);
      resultados.push({
        ambiente: ambiente.nome,
        porta: ambiente.porta,
        ...resultado
      });
    }
  });
  
  return { success: true, resultados };
}

/**
 * Atualizar credenciais de banco no .env do ambiente
 */
async function atualizarCredenciaisBanco(ambienteId, bancoId, credenciais, validarToken = true) {
  const ambiente = getAmbiente(ambienteId);
  if (!ambiente) {
    return { success: false, error: 'Ambiente não encontrado' };
  }
  
  if (!ambiente.bancosPermitidos.includes(bancoId)) {
    return { success: false, error: 'Banco não permitido para este ambiente' };
  }
  
  // Validar token se solicitado e se temos login e senha
  let validacaoToken = null;
  if (validarToken && credenciais.login && credenciais.senha) {
    try {
      // Carregar variáveis de ambiente do .env do ambiente para validação
      const envPath = path.join(BASE_PATH, ambiente.path, '.env');
      if (fs.existsSync(envPath)) {
        require('dotenv').config({ path: envPath });
      }
      
      const { validarTokenBanco } = require('./validar-token-banco');
      validacaoToken = await validarTokenBanco(bancoId, credenciais.login, credenciais.senha);
      
      if (!validacaoToken.success) {
        return {
          success: false,
          error: `Validação de token falhou: ${validacaoToken.error}`,
          validacao: validacaoToken
        };
      }
    } catch (error) {
      console.error('Erro ao validar token:', error);
      // Continuar mesmo se a validação falhar (pode ser problema de rede)
      validacaoToken = {
        success: false,
        error: `Erro ao validar token: ${error.message}`
      };
    }
  }
  
  const envPath = path.join(BASE_PATH, ambiente.path, '.env');
  
  // Ler .env atual
  let envContent = '';
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }
  
  // Mapear credenciais por banco (baseado nos .env da rota-4000)
  const mapeamentoCredenciais = {
    presencabank: {
      login: 'PRECENÇABANK_LOGIN',
      senha: 'PRECENÇABANK_SENHA',
      usr: 'PRECENÇABANK_USR', // Alternativa
      pass: 'PRECENÇABANK_PASS' // Alternativa
    },
    v8: {
      login: 'V8_USERNAME',
      senha: 'V8_PASSWORD',
      usr: 'V8_USR', // Alternativa
      pass: 'V8_PASS' // Alternativa
    },
    hubcredito: {
      login: 'HUBCREDITO_USR',
      senha: 'HUBCREDITO_PASS',
      usr: 'HUBCREDITO_USR',
      pass: 'HUBCREDITO_PASS'
    }
  };
  
  const campos = mapeamentoCredenciais[bancoId];
  if (!campos) {
    return { success: false, error: `Banco ${bancoId} não possui mapeamento de credenciais` };
  }
  
  // Atualizar ou adicionar credenciais
  let linhas = envContent.split('\n');
  let atualizado = false;
  
  // Atualizar login (tentar ambos os formatos)
  if (credenciais.login) {
    // Tentar primeiro com campos.login, depois com campos.usr
    const campoLogin = campos.login || campos.usr;
    const index = linhas.findIndex(l => l.startsWith(campoLogin + '=') || l.startsWith(campos.login + '='));
    if (index >= 0) {
      linhas[index] = `${campoLogin}=${credenciais.login}`;
      atualizado = true;
    } else {
      linhas.push(`${campoLogin}=${credenciais.login}`);
      atualizado = true;
    }
  }
  
  // Atualizar senha (tentar ambos os formatos)
  if (credenciais.senha) {
    // Tentar primeiro com campos.senha, depois com campos.pass
    const campoSenha = campos.senha || campos.pass;
    const index = linhas.findIndex(l => l.startsWith(campoSenha + '=') || l.startsWith(campos.senha + '='));
    if (index >= 0) {
      linhas[index] = `${campoSenha}=${credenciais.senha}`;
      atualizado = true;
    } else {
      linhas.push(`${campoSenha}=${credenciais.senha}`);
      atualizado = true;
    }
  }
  
  if (atualizado) {
    fs.writeFileSync(envPath, linhas.join('\n'), 'utf8');
    return { 
      success: true, 
      message: 'Credenciais atualizadas com sucesso',
      validacao: validacaoToken
    };
  }
  
  return { success: false, error: 'Nenhuma credencial fornecida' };
}

/**
 * Obter credenciais de banco do .env
 */
function obterCredenciaisBanco(ambienteId, bancoId) {
  const ambiente = getAmbiente(ambienteId);
  if (!ambiente) {
    return { success: false, error: 'Ambiente não encontrado' };
  }
  
  const envPath = path.join(BASE_PATH, ambiente.path, '.env');
  
  if (!fs.existsSync(envPath)) {
    return { success: false, error: 'Arquivo .env não encontrado' };
  }
  
  const envContent = fs.readFileSync(envPath, 'utf8');
  const linhas = envContent.split('\n');
  
  const mapeamentoCredenciais = {
    presencabank: {
      login: 'PRECENÇABANK_LOGIN',
      senha: 'PRECENÇABANK_SENHA',
      usr: 'PRECENÇABANK_USR',
      pass: 'PRECENÇABANK_PASS'
    },
    v8: {
      login: 'V8_USERNAME',
      senha: 'V8_PASSWORD',
      usr: 'V8_USR',
      pass: 'V8_PASS'
    },
    hubcredito: {
      login: 'HUBCREDITO_USR',
      senha: 'HUBCREDITO_PASS',
      usr: 'HUBCREDITO_USR',
      pass: 'HUBCREDITO_PASS'
    }
  };
  
  const campos = mapeamentoCredenciais[bancoId];
  if (!campos) {
    return { success: false, error: `Banco ${bancoId} não possui mapeamento` };
  }
  
  const credenciais = {};
  
  linhas.forEach(linha => {
    const campoLogin = campos.login || campos.usr;
    const campoSenha = campos.senha || campos.pass;
    
    if (linha.startsWith(campoLogin + '=') || linha.startsWith(campos.login + '=')) {
      credenciais.login = linha.split('=')[1]?.trim() || '';
    }
    if (linha.startsWith(campoSenha + '=') || linha.startsWith(campos.senha + '=')) {
      credenciais.senha = linha.split('=')[1]?.trim() || '';
    }
  });
  
  return { success: true, credenciais };
}

/**
 * Obter credenciais de um banco em todos os ambientes
 */
function obterCredenciaisBancoTodosAmbientes(bancoId) {
  const { listAmbientes } = require('./database');
  const ambientes = listAmbientes();
  
  const credenciaisPorAmbiente = [];
  
  ambientes.forEach(ambiente => {
    if (ambiente.bancosPermitidos && ambiente.bancosPermitidos.includes(bancoId)) {
      const resultado = obterCredenciaisBanco(ambiente.id, bancoId);
      if (resultado.success) {
        credenciaisPorAmbiente.push({
          ambienteId: ambiente.id,
          ambienteNome: ambiente.nome,
          ambientePorta: ambiente.porta,
          credenciais: resultado.credenciais
        });
      } else {
        credenciaisPorAmbiente.push({
          ambienteId: ambiente.id,
          ambienteNome: ambiente.nome,
          ambientePorta: ambiente.porta,
          credenciais: null,
          erro: resultado.error
        });
      }
    }
  });
  
  return {
    success: true,
    bancoId: bancoId,
    credenciais: credenciaisPorAmbiente
  };
}

/**
 * Atualizar credenciais de banco em um ambiente específico
 */
async function atualizarCredenciaisBancoAmbiente(ambienteId, bancoId, credenciais, validarToken = true) {
  return await atualizarCredenciaisBanco(ambienteId, bancoId, credenciais, validarToken);
}

module.exports = {
  detectarBancosDisponiveis,
  detectarAmbientesExistentes,
  criarEstruturaAmbiente,
  sincronizarBanco,
  sincronizarAmbiente,
  sincronizarTodosAmbientes,
  atualizarCredenciaisBanco,
  obterCredenciaisBanco,
  obterCredenciaisBancoTodosAmbientes,
  atualizarCredenciaisBancoAmbiente
};