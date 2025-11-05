import type { PostFilter } from "./utils/posts";

export interface SiteConfig {
  title: string;
  slogan: string;
  description?: string;
  site: string;
  social: {
    github?: string;
    linkedin?: string;
    email?: string;
    rss?: boolean;
  };
  homepage: PostFilter;
  googleAnalysis?: string;
  search?: boolean;
}

export const siteConfig: SiteConfig = {
  site: "https://gabrielh-muniz.netlify.app/", // your site url
  title: "Gabriel Muniz",
  slogan: "Everything that resides in my brain.",
  description:
    "A blog about programming, technology, and other random thoughts.",
  social: {
    github: "https://github.com/gabrielh-muniz", // leave empty if you don't want to show the github
    linkedin: "https://www.linkedin.com/in/gabriel-muniz-494349315", // leave empty if you don't want to show the linkedin
    email: "", // leave empty if you don't want to show the email
    rss: true, // set this to false if you don't want to provide an rss feed
  },
  homepage: {
    maxPosts: 3,
    tags: [],
    excludeTags: [],
  },
  googleAnalysis: "", // your google analysis id
  search: true, // set this to false if you don't want to provide a search feature
};
