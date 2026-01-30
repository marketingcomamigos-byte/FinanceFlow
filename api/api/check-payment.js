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
        const { paymentId } = req.body;
        
        if (!paymentId) {
            return res.status(400).json({ error: 'Payment ID é obrigatório' });
        }

        // Verificar status no Mercado Pago
        const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
            headers: {
                'Authorization': `Bearer ${mercadoPagoToken}`
            }
        });

        if (!mpResponse.ok) {
            throw new Error(`Erro Mercado Pago: ${mpResponse.status}`);
        }

        const payment = await mpResponse.json();
        
        // Atualizar no Supabase se status mudou
        const { error: updateError } = await supabase
            .from('pagamentos')
            .update({
                status: payment.status,
                data_atualizacao: new Date().toISOString()
            })
            .eq('id_mercado_pago', paymentId);

        if (updateError) {
            console.error('Erro ao atualizar pagamento:', updateError);
        }

        // Se aprovado, verificar se já processamos
        if (payment.status === 'approved') {
            const { data: pagamento } = await supabase
                .from('pagamentos')
                .select('usuario_id, plano, valor')
                .eq('id_mercado_pago', paymentId)
                .single();
            
            if (pagamento) {
                const { data: usuario } = await supabase
                    .from('usuarios')
                    .select('plano')
                    .eq('id', pagamento.usuario_id)
                    .single();
                
                if (usuario && usuario.plano !== 'premium') {
                    await supabase
                        .from('usuarios')
                        .update({ plano: 'premium' })
                        .eq('id', pagamento.usuario_id);
                }
            }
        }

        res.status(200).json({
            success: true,
            status: payment.status,
            status_detail: payment.status_detail,
            date_approved: payment.date_approved
        });

    } catch (error) {
        console.error('Erro ao verificar pagamento:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erro ao verificar pagamento',
            message: error.message 
        });
    }
}
