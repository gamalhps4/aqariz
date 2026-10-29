"use client";

import { PostEditor } from "../_components/post-editor";

/** /admin/blog/new: an empty post. Saving it (as a draft or published) moves
 * the editor to the post's own address. */
export default function NewBlogPostPage() {
  return <PostEditor post={null} />;
}
