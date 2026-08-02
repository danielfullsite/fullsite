import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

/*
  SQL to create the prospects table:

  CREATE TABLE prospects (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    nombre TEXT,
    restaurante TEXT,
    email TEXT,
    teléfono TEXT,
    pos TEXT,
    status TEXT DEFAULT 'nuevo',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
*/

export async function POST(req: NextRequest) {
  try {
    const { nombre, restaurante, email, teléfono, pos } = await req.json()

    if (!nombre || !restaurante || !email || !teléfono || !pos) {
      return NextResponse.json(
        { error: 'Todos los campos son requeridos' },
        { status: 400 }
      )
    }

    // Save to Supabase
    const supabase = createServiceClient()
    const { error: dbError } = await supabase.from('prospects').insert({
      nombre,
      restaurante,
      email,
      teléfono,
      pos,
      status: 'nuevo',
      created_at: new Date().toISOString(),
    })

    if (dbError) {
      console.error('Supabase insert error:', dbError)
      return NextResponse.json(
        { error: 'Error al guardar prospecto' },
        { status: 500 }
      )
    }

    // Notify platform owner on Telegram (optional — silent if TELEGRAM_CHAT_ID_PLATFORM not set)
    const platformChatId = process.env.TELEGRAM_CHAT_ID_PLATFORM
    if (platformChatId && process.env.TELEGRAM_BOT_TOKEN) {
      try {
        await fetch(
          `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: platformChatId,
              text: `🔔 NUEVO PROSPECTO\n\n${nombre}\n${restaurante}\n${email}\n${teléfono}\nPOS: ${pos}`,
            }),
          }
        )
      } catch (telegramError) {
        console.error('Telegram notification error:', telegramError)
      }
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}
