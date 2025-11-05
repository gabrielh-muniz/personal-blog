import { defineCollection, z } from "astro:content";

const blog = defineCollection({
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    date: z.date(),
    tags: z.array(z.string()).optional(),
    draft: z.boolean().optional(),
    image: z.string().optional(), // For public folder images: "/images/post.jpg"
    // OR use: image().optional(), // For src/assets images
  }),
});

export const collections = { blog };
