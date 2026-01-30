import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const mercadoPagoToken = process.env.MERCADO_PAGO_TOKEN;

const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        console.log('Webhook recebido:', req.body);
        
        const { type, data } = req.body;
        
        if (type === 'payment') {
            const paymentId = data.id;
            
            // Buscar detalhes do pagamento no Mercado Pago
            const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                headers: {
                    'Authorization': `Bearer ${mercadoPagoToken}`
                }
            });
            
            if (!mpResponse.ok) {
                throw new Error(`Erro Mercado Pago: ${mpResponse.status}`);
            }
            
            const payment = await mpResponse.json();
            console.log('Pagamento MP:', payment.status, payment.external_reference);
            
            // Atualizar pagamento no Supabase
            const { error: updateError } = await supabase
                .from('pagamentos')
                .update({
                    status: payment.status,
                    data_atualizacao: new Date().toISOString()
                })
                .eq('id_mercado_pago', paymentId);
            
            if (updateError) {
                console.error('Erro ao atualizar pagamento:', updateError);
                throw updateError;
            }
            
            // Log do webhook
            await supabase
                .from('log_pagamentos')
                .insert({
                    pagamento_id: paymentId,
                    acao: 'webhook_recebido',
                    status: payment.status,
                    detalhes: payment,
                    ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress
                });
            
            // Se pagamento aprovado, processar assinatura
            if (payment.status === 'approved') {
                await processarPagamentoAprovado(payment);
            }
            
            res.status(200).json({ received: true, processed: true });
        } else {
            res.status(200).json({ received: true, processed: false });
        }
        
    } catch (error) {
        console.error('Erro no webhook:', error);
        
        // Log do erro
        await supabase
            .from('log_pagamentos')
            .insert({
                pagamento_id: 'webhook_error',
                acao: 'erro_webhook',
                status: 'error',
                detalhes: { error: error.message, body: req.body },
                ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress
            });
        
        res.status(500).json({ error: 'Internal server error', message: error.message });
    }
}

async function processarPagamentoAprovado(payment) {
    try {
        // Buscar pagamento no banco
        const { data: pagamentoData, error: pagamentoError } = await supabase
            .from('pagamentos')
            .select('*')
            .eq('id_mercado_pago', payment.id)
            .single();
        
        if (pagamentoError || !pagamentoData) {
            console.error('Pagamento não encontrado no banco:', payment.id);
            return;
        }
        
        // Atualizar usuário para premium
        const { error: usuarioError } = await supabase
            .from('usuarios')
            .update({ 
                plano: 'premium',
                transacoes_realizadas: 0 
            })
            .eq('id', pagamentoData.usuario_id);
        
        if (usuarioError) {
            console.error('Erro ao atualizar usuário:', usuarioError);
            throw usuarioError;
        }
        
        // Calcular data de vencimento
        const dataInicio = new Date();
        const dataVencimento = new Date();
        
        if (pagamentoData.plano === 'mensal') {
            dataVencimento.setMonth(dataVencimento.getMonth() + 1);
        } else if (pagamentoData.plano === 'anual') {
            dataVencimento.setFullYear(dataVencimento.getFullYear() + 1);
        } else {
            dataVencimento.setMonth(dataVencimento.getMonth() + 1);
        }
        
        // Criar/atualizar assinatura
        const { error: assinaturaError } = await supabase
            .from('assinaturas')
            .upsert({
                usuario_id: pagamentoData.usuario_id,
                pagamento_id: pagamentoData.id,
                plano: pagamentoData.plano,
                status: 'ativa',
                data_inicio: dataInicio.toISOString(),
                data_vencimento: dataVencimento.toISOString(),
                valor: pagamentoData.valor,
                renovacao_automatica: false,
                data_atualizacao: new Date().toISOString()
            }, {
                onConflict: 'usuario_id',
                ignoreDuplicates: false
            });
        
        if (assinaturaError) {
            console.error('Erro ao criar assinatura:', assinaturaError);
            throw assinaturaError;
        }
        
        // Criar notificação para o usuário
        await supabase
            .from('notificacoes')
            .insert({
                usuario_id: pagamentoData.usuario_id,
                titulo: '🎉 Pagamento Aprovado!',
                mensagem: `Seu pagamento de R$ ${pagamentoData.valor} foi aprovado! Sua conta agora é Premium até ${dataVencimento.toLocaleDateString('pt-BR')}.`,
                tipo: 'success',
                lida: false
            });
        
        console.log('Assinatura processada com sucesso para usuário:', pagamentoData.usuario_id);
        
    } catch (error) {
        console.error('Erro ao processar pagamento aprovado:', error);
        throw error;
    }
}
