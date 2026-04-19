import { FiUser } from "react-icons/fi";

const avatarImageStyle = {
  width: "100%",
  height: "100%",
  display: "block",
  objectFit: "cover",
  borderRadius: "inherit",
};

export default function UserAvatar({ avatarUrl = "", name = "", className = "" }) {
  const normalizedAvatarUrl = String(avatarUrl ?? "").trim();
  const normalizedName = String(name ?? "").trim();
  const initial = normalizedName.slice(0, 1).toUpperCase();

  return (
    <span className={className} aria-hidden="true">
      {normalizedAvatarUrl ? <img src={normalizedAvatarUrl} alt="" style={avatarImageStyle} /> : initial || <FiUser />}
    </span>
  );
}
