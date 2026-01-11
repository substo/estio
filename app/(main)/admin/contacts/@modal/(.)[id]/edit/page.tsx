
import ContactModal from '../../../_components/contact-modal';

export default async function ContactEditModalPage(props: { params: Promise<{ id: string }> }) {
    const params = await props.params;
    return <ContactModal contactId={params.id} mode="edit" />;
}
