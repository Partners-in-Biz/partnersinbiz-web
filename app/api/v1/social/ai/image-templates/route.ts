/**
 * GET /api/v1/social/ai/image-templates — authenticated social tooling templates.
 */
import { apiSuccess } from '@/lib/api/response'
import { withAuth } from '@/lib/api/auth'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

interface ImageTemplate {
  id: string
  name: string
  description: string
  promptTemplate: string
  suggestedSize: '1024x1024' | '1024x1536' | '1536x1024'
  category: 'product' | 'quote' | 'event' | 'blog' | 'testimonial' | 'promotion' | 'comparison' | 'infographic'
}

const TEMPLATES: ImageTemplate[] = [
  {
    id: 'product-announcement',
    name: 'Product Announcement',
    description: 'Eye-catching product launch or update announcement',
    promptTemplate: 'Create a professional product announcement image for {{productName}}. Show the product prominently with clean modern design, {{additionalDetails}}. Use vibrant colors and clear typography. Professional photography style.',
    suggestedSize: '1024x1024',
    category: 'product',
  },
  {
    id: 'quote-card',
    name: 'Quote Card',
    description: 'Inspirational or motivational quote card',
    promptTemplate: 'Design a beautiful quote card with the text "{{quoteText}}" in elegant typography. {{authorInfo}}. Use a {{colorScheme}} color scheme with a visually appealing background. Modern minimalist design.',
    suggestedSize: '1024x1024',
    category: 'quote',
  },
  {
    id: 'event-promotion',
    name: 'Event Promotion',
    description: 'Engaging promotional image for events or webinars',
    promptTemplate: 'Create a vibrant event promotion poster for {{eventName}}. Include date {{eventDate}} and {{eventTime}}. Show {{eventType}} theme with dynamic visuals. {{venueOrOnline}}. Modern, eye-catching design.',
    suggestedSize: '1024x1536',
    category: 'event',
  },
  {
    id: 'blog-preview',
    name: 'Blog Preview',
    description: 'Thumbnail for blog posts and articles',
    promptTemplate: 'Design a blog post preview image for "{{articleTitle}}". Focus on {{topicArea}} with {{visualStyle}} design. Include relevant icons or illustrations. Professional and engaging layout.',
    suggestedSize: '1024x1024',
    category: 'blog',
  },
  {
    id: 'testimonial-card',
    name: 'Testimonial',
    description: 'Customer testimonial or review card',
    promptTemplate: 'Create a professional testimonial card with the quote "{{testimonialText}}" from {{authorName}}. {{authorRole}}. Add a {{companyOrProduct}} branding element. Clean, trustworthy design with {{colorScheme}} colors.',
    suggestedSize: '1024x1024',
    category: 'testimonial',
  },
  {
    id: 'sale-discount',
    name: 'Sale/Discount',
    description: 'Promotion or discount announcement',
    promptTemplate: 'Create an eye-catching sales promotion image with {{discountPercentage}}% OFF on {{productOrService}}. Bold, attention-grabbing design with {{urgencyMessage}}. Use bright contrasting colors. Include "{{callToAction}}" text.',
    suggestedSize: '1024x1024',
    category: 'promotion',
  },
  {
    id: 'before-after',
    name: 'Before & After',
    description: 'Before and after comparison showcase',
    promptTemplate: 'Design a split before/after comparison image. Left side shows {{beforeState}} (labeled "Before"), right side shows {{afterState}} (labeled "After"). Use arrows or divider to show transformation. {{resultHighlight}}. Professional presentation.',
    suggestedSize: '1536x1024',
    category: 'comparison',
  },
  {
    id: 'infographic',
    name: 'Infographic',
    description: 'Data visualization or infographic',
    promptTemplate: 'Create an infographic about {{topic}}. Include the key statistics: {{statistic1}}, {{statistic2}}, and {{statistic3}}. Use {{colorScheme}} color scheme with clear icons and typography. {{styleDescription}}. Easy to understand at a glance.',
    suggestedSize: '1024x1536',
    category: 'infographic',
  },
]

export const GET = withAuth('client', async (): Promise<NextResponse> => {
  return apiSuccess(TEMPLATES)
})
