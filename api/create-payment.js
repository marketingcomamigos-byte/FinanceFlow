import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const mercadoPagoToken = process.env.MERCADO_PAGO_TOKEN;
const webhookUrl = process.env.VERCEL_URL ? 
    `https://${process.env.VERCEL_URL}/api/mercadopago-webhook` : 
    'https://finance-flow-ea89w206i-rogerios-projects-8555d6cd.vercel.app/api/mercadopago-webhook';

const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { valor, descricao, plano, usuarioId } = req.body;
        
        if (!valor || !descricao || !plano || !usuarioId) {
            return res.status(400).json({ error: 'Dados incompletos' });
        }

        // Buscar informações do usuário
        const { data: usuario, error: userError } = await supabase
            .from('usuarios')
            .select('nome, email')
            .eq('id', usuarioId)
            .single();
        
        if (userError || !usuario) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        // Criar pagamento no Mercado Pago
        const paymentData = {
            transaction_amount: parseFloat(valor),
            description: descricao,
            payment_method_id: "pix",
            payer: {
                email: usuario.email,
                first_name: usuario.nome.split(' ')[0],
                last_name: usuario.nome.split(' ').slice(1).join(' ') || "Usuário"
            },
            notification_url: webhookUrl,
            external_reference: `usuario_${usuarioId}_plano_${plano}_${Date.now()}`,
            date_of_expiration: new Date(Date.now() + 30 * 60 * 1000).toISOString()
        };

        console.log('Criando pagamento no MP:', paymentData);

        const mpResponse = await fetch('https://api.mercadopago.com/v1/payments', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${mercadoPagoToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(paymentData)
        });

        if (!mpResponse.ok) {
            const errorText = await mpResponse.text();
            console.error('Erro Mercado Pago:', errorText);
            throw new Error(`Erro Mercado Pago: ${mpResponse.status} - ${errorText}`);
        }

        const payment = await mpResponse.json();
        console.log('Pagamento criado:', payment.id, payment.status);

        // Salvar pagamento no Supabase
        const { data: pagamentoSalvo, error: saveError } = await supabase
            .from('pagamentos')
            .insert({
                usuario_id: usuarioId,
                id_mercado_pago: payment.id,
                descricao: descricao,
                valor: valor,
                status: payment.status,
                metodo_pagamento: 'pix',
                plano: plano,
                external_reference: payment.external_reference,
                qr_code: payment.point_of_interaction?.transaction_data?.qr_code,
                qr_code_base64: payment.point_of_interaction?.transaction_data?.qr_code_base64,
                ticket_url: payment.point_of_interaction?.transaction_data?.ticket_url,
                data_expiracao: payment.date_of_expiration
            })
            .select()
            .single();

        if (saveError) {
            console.error('Erro ao salvar pagamento:', saveError);
            throw saveError;
        }

        // Log do pagamento
        await supabase
            .from('log_pagamentos')
            .insert({
                pagamento_id: payment.id,
                acao: 'pagamento_criado',
                status: payment.status,
                detalhes: { 
                    payment_id: payment.id,
                    valor: valor,
                    plano: plano 
                }
            });

        res.status(200).json({
            success: true,
            payment: {
                id: payment.id,
                status: payment.status,
                qr_code: payment.point_of_interaction?.transaction_data?.qr_code,
                qr_code_base64: payment.point_of_interaction?.transaction_data?.qr_code_base64,
                ticket_url: payment.point_of_interaction?.transaction_data?.ticket_url,
                date_of_expiration: payment.date_of_expiration,
                transaction_amount: payment.transaction_amount
            },
            pagamento_id: pagamentoSalvo.id
        });

    } catch (error) {
        console.error('Erro ao criar pagamento:', error);
        
        await supabase
            .from('log_pagamentos')
            .insert({
                pagamento_id: 'create_error',
                acao: 'erro_criacao_pagamento',
                status: 'error',
                detalhes: { error: error.message, body: req.body }
            });
        
        res.status(500).json({ 
            success: false, 
            error: 'Erro ao criar pagamento',
            message: error.message 
        });
    }
}
