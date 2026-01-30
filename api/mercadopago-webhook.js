// mercadopago-webhook.js - VERSÃO CORRIGIDA E FUNCIONAL
export default async function handler(req, res) {
    // Configurar CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Lidar com OPTIONS para CORS
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        console.log('🔔 Webhook recebido do Mercado Pago');
        
        const { type, data } = req.body;
        
        if (type === 'payment') {
            const paymentId = data.id;
            console.log(`💰 Processando pagamento ID: ${paymentId}`);
            
            // IMPORTANTE: Responder IMEDIATAMENTE para evitar timeout
            res.status(200).json({ 
                received: true, 
                processing: true,
                paymentId: paymentId
            });
            
            // Processar em segundo plano
            setTimeout(async () => {
                await processPaymentBackground(paymentId);
            }, 100);
            
        } else {
            res.status(200).json({ 
                received: true, 
                message: 'Webhook não é de pagamento' 
            });
        }
        
    } catch (error) {
        console.error('❌ Erro no webhook:', error);
        res.status(200).json({ 
            received: true, 
            error: error.message 
        });
    }
}

// Função para processar em segundo plano
async function processPaymentBackground(paymentId) {
    try {
        console.log(`⏳ Processando pagamento ${paymentId} em background...`);
        
        // Usar fetch diretamente para evitar problemas com @supabase/supabase-js
        const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rprocjpzydkondrguzui.supabase.co';
        const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJwcm9janB6eWRrb25kcmd1enVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM2ODA2NjIsImV4cCI6MjA3OTI1NjY2Mn0.bD36ix62EYFdnnTKXN3iK9C9AoOeKyWGkY10D-A1tm0';
        const MERCADOPAGO_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN || 'APP_USR-822136515431736-013007-7ed1586544474bff3bca6037cea26d1a-10155732';
        
        // 1. Buscar detalhes do pagamento no Mercado Pago
        console.log('📡 Buscando detalhes do Mercado Pago...');
        const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
            headers: {
                'Authorization': `Bearer ${MERCADOPAGO_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!mpResponse.ok) {
            const errorText = await mpResponse.text();
            console.error(`❌ Erro Mercado Pago: ${mpResponse.status}`, errorText);
            return;
        }
        
        const payment = await mpResponse.json();
        console.log(`📊 Status do pagamento: ${payment.status}`);
        console.log(`🔗 External Reference: ${payment.external_reference}`);
        
        // 2. Atualizar pagamento no Supabase
        console.log('💾 Atualizando pagamento no Supabase...');
        const updateResponse = await fetch(`${SUPABASE_URL}/rest/v1/pagamentos?id_mercado_pago=eq.${paymentId}`, {
            method: 'PATCH',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
                status: payment.status,
                status_detail: payment.status_detail,
                date_approved: payment.date_approved,
                updated_at: new Date().toISOString()
            })
        });
        
        if (!updateResponse.ok) {
            console.error('❌ Erro ao atualizar pagamento:', await updateResponse.text());
        } else {
            console.log('✅ Pagamento atualizado no Supabase');
        }
        
        // 3. Log do webhook
        await fetch(`${SUPABASE_URL}/rest/v1/log_pagamentos`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
                pagamento_id: paymentId,
                acao: 'webhook_recebido',
                status: payment.status,
                detalhes: JSON.stringify(payment),
                ip: 'webhook_background',
                created_at: new Date().toISOString()
            })
        });
        
        // 4. Se pagamento aprovado, processar assinatura
        if (payment.status === 'approved') {
            console.log('🎉 Pagamento APROVADO! Processando assinatura...');
            await processarPagamentoAprovado(payment, SUPABASE_URL, SUPABASE_KEY);
        }
        
        console.log(`✅ Processamento do pagamento ${paymentId} concluído`);
        
    } catch (error) {
        console.error(`❌ Erro no processamento background:`, error);
    }
}

async function processarPagamentoAprovado(payment, SUPABASE_URL, SUPABASE_KEY) {
    try {
        // 1. Buscar pagamento no banco
        console.log('🔍 Buscando pagamento no banco...');
        const pagamentoResponse = await fetch(
            `${SUPABASE_URL}/rest/v1/pagamentos?id_mercado_pago=eq.${payment.id}&select=*`,
            {
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        if (!pagamentoResponse.ok) {
            console.error('❌ Erro ao buscar pagamento:', await pagamentoResponse.text());
            return;
        }
        
        const pagamentos = await pagamentoResponse.json();
        
        if (!pagamentos || pagamentos.length === 0) {
            console.error('❌ Pagamento não encontrado no banco:', payment.id);
            return;
        }
        
        const pagamentoData = pagamentos[0];
        const userId = pagamentoData.usuario_id;
        
        console.log(`👤 Processando usuário ID: ${userId}`);
        
        // 2. Atualizar usuário para premium
        console.log('⬆️ Atualizando usuário para premium...');
        const usuarioResponse = await fetch(`${SUPABASE_URL}/rest/v1/usuarios?id=eq.${userId}`, {
            method: 'PATCH',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ 
                plano: 'premium',
                transacoes_realizadas: 0,
                updated_at: new Date().toISOString()
            })
        });
        
        if (!usuarioResponse.ok) {
            console.error('❌ Erro ao atualizar usuário:', await usuarioResponse.text());
        } else {
            console.log('✅ Usuário atualizado para premium');
        }
        
        // 3. Calcular data de vencimento
        const dataInicio = new Date();
        const dataVencimento = new Date();
        const plano = pagamentoData.plano || 'mensal';
        
        if (plano === 'anual') {
            dataVencimento.setFullYear(dataVencimento.getFullYear() + 1);
        } else {
            dataVencimento.setMonth(dataVencimento.getMonth() + 1);
        }
        
        // 4. Criar/atualizar assinatura
        console.log('📝 Criando/atualizando assinatura...');
        const assinaturaData = {
            usuario_id: userId,
            pagamento_id: pagamentoData.id,
            plano: plano,
            status: 'ativa',
            data_inicio: dataInicio.toISOString(),
            data_vencimento: dataVencimento.toISOString(),
            valor: pagamentoData.valor || payment.transaction_amount,
            renovacao_automatica: false,
            data_atualizacao: new Date().toISOString(),
            created_at: new Date().toISOString()
        };
        
        // Primeiro verificar se já existe assinatura
        const checkAssinaturaResponse = await fetch(
            `${SUPABASE_URL}/rest/v1/assinaturas?usuario_id=eq.${userId}`,
            {
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        if (checkAssinaturaResponse.ok) {
            const assinaturas = await checkAssinaturaResponse.json();
            
            if (assinaturas.length > 0) {
                // Atualizar
                await fetch(`${SUPABASE_URL}/rest/v1/assinaturas?id=eq.${assinaturas[0].id}`, {
                    method: 'PATCH',
                    headers: {
                        'apikey': SUPABASE_KEY,
                        'Authorization': `Bearer ${SUPABASE_KEY}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'return=minimal'
                    },
                    body: JSON.stringify(assinaturaData)
                });
                console.log('✅ Assinatura atualizada');
            } else {
                // Criar nova
                await fetch(`${SUPABASE_URL}/rest/v1/assinaturas`, {
                    method: 'POST',
                    headers: {
                        'apikey': SUPABASE_KEY,
                        'Authorization': `Bearer ${SUPABASE_KEY}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'return=minimal'
                    },
                    body: JSON.stringify(assinaturaData)
                });
                console.log('✅ Nova assinatura criada');
            }
        }
        
        // 5. Criar notificação para o usuário
        console.log('🔔 Criando notificação...');
        await fetch(`${SUPABASE_URL}/rest/v1/notificacoes`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
                usuario_id: userId,
                titulo: '🎉 Pagamento Aprovado!',
                mensagem: `Seu pagamento de R$ ${(pagamentoData.valor || payment.transaction_amount).toFixed(2)} foi aprovado! Sua conta agora é Premium até ${dataVencimento.toLocaleDateString('pt-BR')}.`,
                tipo: 'success',
                lida: false,
                created_at: new Date().toISOString()
            })
        });
        
        console.log(`✨ Processamento completo para usuário ${userId}`);
        
    } catch (error) {
        console.error('❌ Erro ao processar pagamento aprovado:', error);
    }
}
