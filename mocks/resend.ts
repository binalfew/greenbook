import { faker } from '@faker-js/faker'
import { HttpResponse, http, type HttpHandler } from 'msw'
import { z } from 'zod'
const { json } = HttpResponse

const EmailSchema = z.object({
	from: z.string(),
	to: z.string(),
	subject: z.string(),
	text: z.string(),
	html: z.string(),
})

export const handlers: Array<HttpHandler> = [
	http.post(`https://api.resend.com/emails`, async ({ request }) => {
		const body = await request.json()
		console.info('🔶 mocked email contents:', body)

		const email = EmailSchema.parse(body)

		return json({
			id: faker.string.uuid(),
			from: email.from,
			to: email.to,
			created_at: new Date().toISOString(),
		})
	}),
]
